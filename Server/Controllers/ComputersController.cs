using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BenBotInventory.Server.Controllers;

public record AssignPartsRequest(List<int> PartIds);
public record SetComputerPriceRequest(decimal? Price);

/// <summary>
/// Payment payload plus optional computer customer fields (never stored on Payment).
/// </summary>
public class AddPaymentRequest
{
    public decimal Amount { get; set; }
    public decimal? Tax { get; set; }
    public decimal? Fee { get; set; }
    public string? Method { get; set; }
    public DateTime Date { get; set; }
    public string? PaymentUrl { get; set; }
    public string Type { get; set; } = "payment";

    public string? CustomerName { get; set; }
    public string? CustomerUrl { get; set; }
    public string? ConversationUrl { get; set; }
}

[ApiController]
[Route("api/computers")]
[Authorize(Policy = PermissionPolicies.Level2)]
public class ComputersController : ControllerBase
{
    private static readonly string[] ValidStatuses =
        { "Planned", "In-progress", "Built", "Active", "Sold", "Returned", "Needs repair", "Traded", "Personal" };

    /// <summary>Statuses that imply inventory parts are on hand and verified.</summary>
    private static readonly HashSet<string> StatusesThatConfirmParts =
        new(StringComparer.OrdinalIgnoreCase) { "Built", "Active", "Sold" };

    private static readonly string[] ValidTypes = { "PC", "Parts" };

    // Sort priority: deposit-first handled separately; status order:
    private static readonly Dictionary<string, int> StatusOrder = new()
    {
        ["Needs repair"] = 1,
        ["Active"] = 2,
        ["Built"] = 3,
        ["Personal"] = 4,
        ["In-progress"] = 5,
        ["Planned"] = 6,
        ["Returned"] = 7,
        ["Traded"] = 8,
        ["Sold"] = 9
    };

    /// <summary>Owner's user id; wages paid to this user count toward Ben Profit.</summary>
    private const string BenUserId = "Ben L";

    private static bool IsJosh(string builderUserId) =>
        builderUserId.StartsWith("Josh B", StringComparison.OrdinalIgnoreCase);

    /// <summary>Profit minus all wages, with wages paid to Ben L added back.</summary>
    private static decimal BenProfitOf(decimal profit, decimal allWages, decimal benWages) =>
        profit - allWages + benWages;

    private readonly AppDbContext _db;
    private readonly PartSlotService _slots;

    public ComputersController(AppDbContext db, PartSlotService slots)
    {
        _db = db;
        _slots = slots;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetComputers(
        [FromQuery] bool includeSold = false,
        [FromQuery] bool includeTraded = false,
        [FromQuery] bool includePersonal = false,
        [FromQuery] bool soldOnly = false,
        [FromQuery] int? soldYear = null,
        [FromQuery] string? search = null,
        [FromQuery] string? name = null,
        [FromQuery] string? builder = null,
        [FromQuery] string? addedUser = null,
        [FromQuery] string? location = null,
        [FromQuery] string? customer = null,
        [FromQuery] string? part = null)
    {
        var requiredTypes = await _db.PartTypes.AsNoTracking()
            .Where(t => t.Required).Select(t => t.Type).ToListAsync();

        // List endpoint: aggregate in SQL — do not Include Parts/Payments graphs
        // (those load on expand via GET /api/computers/{id}).
        var query = _db.Computers.AsNoTracking().AsQueryable();

        if (soldOnly)
        {
            query = query.Where(c => c.Status == "Sold");
            if (soldYear.HasValue)
                query = query.Where(c => c.SoldDate != null && c.SoldDate.Value.Year == soldYear.Value);
        }
        else
        {
            if (!includeSold)
                query = query.Where(c => c.Status != "Sold");
            if (!includeTraded)
                query = query.Where(c => c.Status != "Traded");
            if (!includePersonal)
                query = query.Where(c => c.Status != "Personal");
        }

        if (!string.IsNullOrWhiteSpace(name))
            query = query.Where(c => c.Name.Contains(name));
        if (!string.IsNullOrWhiteSpace(builder))
            query = query.Where(c => c.BuilderUserId == builder);
        if (!string.IsNullOrWhiteSpace(addedUser))
            query = query.Where(c => c.AddedUserId == addedUser);
        if (!string.IsNullOrWhiteSpace(location))
            query = query.Where(c => c.Location == location);
        if (!string.IsNullOrWhiteSpace(customer))
            query = query.Where(c => c.CustomerName!.Contains(customer));
        if (!string.IsNullOrWhiteSpace(part))
            query = query.Where(c => c.Parts.Any(p =>
                p.Manufacturer!.Contains(part) || p.ModelNumber!.Contains(part) || p.Type.Contains(part)));
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(c =>
                c.Name.Contains(search) ||
                c.CustomerName!.Contains(search) ||
                c.BuilderUserId!.Contains(search) ||
                c.AddedUserId!.Contains(search) ||
                c.Location!.Contains(search) ||
                c.Parts.Any(p => p.Manufacturer!.Contains(search) || p.ModelNumber!.Contains(search)));

        var users = await _db.Users.AsNoTracking().Select(u => new { u.Id, u.Name }).ToListAsync();
        var userNames = users.ToDictionary(u => u.Id, u => u.Name);

        var rows = await query
            .Select(c => new
            {
                c.Id, c.Name, c.Description, c.Type, c.Status, c.AddedDate,
                c.AddedUserId, c.BuilderUserId, c.Location, c.Price, c.Tax, c.OriginalPrice, c.SoldDate,
                c.CustomerName, c.CustomerUrl, c.ConversationUrl, c.CustomerInfo,
                c.CustomerAddress1, c.CustomerAddress2, c.CustomerCity, c.CustomerState, c.CustomerZip,
                c.TrackingNumber, c.TrackingStatus, c.Notes, c.ExpectedCompletionDate,
                c.IgnoreIncomplete,
                // Parts inventory cost + BulkCost (misc purchases from Misc 3).
                PartsCost = (c.Parts.Sum(p => (decimal?)(p.Cost ?? 0)) ?? 0) + (c.BulkCost ?? 0),
                c.BulkDesc,
                c.BulkCost,
                NetPaid = c.Payments.Sum(p => (decimal?)(p.Type == "refund" ? -p.Amount : p.Amount)) ?? 0,
                PaymentFees = c.Payments.Sum(p => (decimal?)(p.Fee ?? 0)) ?? 0,
                HasDeposit = c.Payments.Any(p => p.Type == "deposit"),
                HasPayment = c.Payments.Any(p => p.Type == "payment"),
                // Import maps Branden Misc3 wages → "Branden J", AI–AL Josh wages → "Josh B".
                WagesBranden = c.Wages
                    .Where(w => w.BuilderUserId.StartsWith("Branden"))
                    .Sum(w => (decimal?)w.Amount) ?? 0,
                WagesJosh = c.Wages
                    .Where(w => w.BuilderUserId == "Josh B" || w.BuilderUserId.StartsWith("Josh B"))
                    .Sum(w => (decimal?)w.Amount) ?? 0,
                WagesNonJosh = c.Wages
                    .Where(w => !(w.BuilderUserId == "Josh B" || w.BuilderUserId.StartsWith("Josh B")))
                    .Sum(w => (decimal?)w.Amount) ?? 0,
                WagesBenL = c.Wages
                    .Where(w => w.BuilderUserId == BenUserId)
                    .Sum(w => (decimal?)w.Amount) ?? 0,
                JoshSharePercentage = c.Shares
                    .Where(s => s.BuilderUserId == "Josh B" || s.BuilderUserId.StartsWith("Josh B"))
                    .Sum(s => (decimal?)s.Percentage),
                // One Parts projection (not three) so EF does not join Parts repeatedly.
                PartsMeta = c.Parts.Select(p => new { p.Type, p.Location }).ToList(),
                PlaceholderTypes = c.Type == "PC"
                    ? c.Placeholders.Select(ph => ph.Type).ToList()
                    : new List<string>()
            })
            .ToListAsync();

        var unnamedIds = rows
            .Where(c => string.IsNullOrWhiteSpace(c.Name))
            .Select(c => c.Id);
        var generatedNames = await ComputerDisplayName.MapUnnamedAsync(_db, unnamedIds);

        var result = rows.Select(c =>
        {
            var presentTypes = c.PartsMeta.Select(p => p.Type).Concat(c.PlaceholderTypes).ToHashSet();
            var missingRequired = c.Type == "PC"
                ? requiredTypes.Where(rt => !presentTypes.Contains(rt)).ToList()
                : new List<string>();
            // Price is tax-inclusive; profit uses pretax revenue (Price − Tax) minus fees.
            var profit = (c.Price ?? 0) - (c.Tax ?? 0) - c.PartsCost - c.PaymentFees;
            var hasWrongLocationParts = !string.IsNullOrWhiteSpace(c.Location)
                && c.PartsMeta.Any(p =>
                    !string.Equals((p.Location ?? "").Trim(), c.Location.Trim(), StringComparison.OrdinalIgnoreCase));

            string displayName;
            if (!string.IsNullOrWhiteSpace(c.Name))
                displayName = c.Name.Trim();
            else if (generatedNames.TryGetValue(c.Id, out var generated))
                displayName = generated;
            else
                displayName = "Unnamed";

            return new
            {
                c.Id, c.Name,
                DisplayName = displayName,
                c.Description, c.Type, c.Status, c.AddedDate,
                c.AddedUserId,
                AddedUserName = c.AddedUserId != null && userNames.TryGetValue(c.AddedUserId, out var an) ? an : null,
                c.BuilderUserId,
                BuilderName = c.BuilderUserId != null && userNames.TryGetValue(c.BuilderUserId, out var bn) ? bn : null,
                c.Location, c.Price, c.Tax, c.OriginalPrice, c.SoldDate,
                c.CustomerName, c.CustomerUrl, c.ConversationUrl, c.CustomerInfo,
                c.CustomerAddress1, c.CustomerAddress2, c.CustomerCity, c.CustomerState, c.CustomerZip,
                c.TrackingNumber, c.TrackingStatus, c.Notes, c.ExpectedCompletionDate,
                c.IgnoreIncomplete,
                c.BulkDesc,
                c.BulkCost,
                c.PartsCost,
                c.NetPaid,
                c.PaymentFees,
                c.HasDeposit,
                c.HasPayment,
                Profit = profit,
                c.WagesBranden,
                c.WagesJosh,
                ProfitBen = profit - c.WagesBranden - c.WagesJosh,
                c.WagesNonJosh,
                c.JoshSharePercentage,
                BenProfit = BenProfitOf(profit, c.WagesNonJosh + c.WagesJosh, c.WagesBenL),
                IsShipping = !string.IsNullOrEmpty(c.TrackingNumber) || !string.IsNullOrEmpty(c.CustomerAddress1),
                MissingRequiredTypes = missingRequired,
                HasWrongLocationParts = hasWrongLocationParts,
                // Detail collections load on expand — keep empty arrays for client shape.
                Parts = Array.Empty<object>(),
                Placeholders = Array.Empty<object>(),
                Payments = Array.Empty<object>(),
                Wages = Array.Empty<object>(),
                Shares = Array.Empty<object>()
            };
        })
        .OrderBy(x => x.Status != "Sold" && x.HasDeposit ? 0 : 1)
        .ThenBy(x => StatusOrder.TryGetValue(x.Status, out var o) ? o : 99)
        .ThenByDescending(x => x.Status == "Sold" ? x.SoldDate : x.AddedDate)
        .ToList();

        return result;
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<object>> GetComputer(int id)
    {
        var computer = await _db.Computers.AsNoTracking()
            .Include(c => c.Parts)
            .Include(c => c.Placeholders)
            .Include(c => c.Payments)
            .Include(c => c.Wages)
            .Include(c => c.Shares)
            .FirstOrDefaultAsync(c => c.Id == id);
        if (computer is null) return NotFound();

        var requiredTypes = computer.Type == "PC"
            ? await _db.PartTypes.AsNoTracking().Where(t => t.Required).Select(t => t.Type).ToListAsync()
            : new List<string>();
        var presentTypes = computer.Parts.Select(p => p.Type)
            .Concat(computer.Placeholders.Select(ph => ph.Type))
            .ToHashSet();
        var missingRequired = computer.Type == "PC"
            ? requiredTypes.Where(rt => !presentTypes.Contains(rt)).ToList()
            : new List<string>();

        var partsCost = computer.Parts.Sum(p => p.Cost ?? 0) + (computer.BulkCost ?? 0);
        var netPaid = computer.Payments.Sum(p => p.Type == "refund" ? -p.Amount : p.Amount);
        var paymentFees = computer.Payments.Sum(p => p.Fee ?? 0);
        var wagesBranden = computer.Wages
            .Where(w => w.BuilderUserId.StartsWith("Branden", StringComparison.OrdinalIgnoreCase))
            .Sum(w => w.Amount);
        var wagesJosh = computer.Wages
            .Where(w => w.BuilderUserId.Equals("Josh B", StringComparison.OrdinalIgnoreCase)
                        || w.BuilderUserId.StartsWith("Josh B", StringComparison.OrdinalIgnoreCase))
            .Sum(w => w.Amount);
        var wagesNonJosh = computer.Wages.Where(w => !IsJosh(w.BuilderUserId)).Sum(w => w.Amount);
        var wagesBenL = computer.Wages
            .Where(w => w.BuilderUserId.Equals(BenUserId, StringComparison.OrdinalIgnoreCase))
            .Sum(w => w.Amount);
        var joshShares = computer.Shares.Where(s => IsJosh(s.BuilderUserId)).ToList();
        decimal? joshSharePercentage = joshShares.Count > 0 ? joshShares.Sum(s => s.Percentage) : null;
        var profit = (computer.Price ?? 0) - (computer.Tax ?? 0) - partsCost - paymentFees;
        var buildLoc = (computer.Location ?? "").Trim();
        var hasWrongLocationParts = buildLoc.Length > 0
            && computer.Parts.Any(p =>
                !string.Equals((p.Location ?? "").Trim(), buildLoc, StringComparison.OrdinalIgnoreCase));

        var shareRecipientIds = computer.Shares
            .Select(s => s.BuilderUserId)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var nonShareWages = computer.Wages
            .Where(w => !shareRecipientIds.Contains(w.BuilderUserId))
            .Sum(w => w.Amount);
        var shareBase = profit - nonShareWages;

        var shareBuilderIds = computer.Shares.Select(s => s.BuilderUserId).Distinct().ToList();
        var shareUsers = shareBuilderIds.Count == 0
            ? new List<(string Id, string Name)>()
            : (await _db.Users.AsNoTracking()
                .Where(u => shareBuilderIds.Contains(u.Id))
                .Select(u => new { u.Id, u.Name })
                .ToListAsync())
                .Select(u => (u.Id, u.Name))
                .ToList();
        var shareUserNames = shareUsers.ToDictionary(u => u.Id, u => u.Name, StringComparer.OrdinalIgnoreCase);

        string? addedUserName = null;
        string? builderName = null;
        if (computer.AddedUserId != null || computer.BuilderUserId != null)
        {
            var users = await _db.Users.AsNoTracking()
                .Where(u => u.Id == computer.AddedUserId || u.Id == computer.BuilderUserId)
                .Select(u => new { u.Id, u.Name })
                .ToListAsync();
            addedUserName = users.FirstOrDefault(u => u.Id == computer.AddedUserId)?.Name;
            builderName = users.FirstOrDefault(u => u.Id == computer.BuilderUserId)?.Name;
        }

        return new
        {
            computer.Id, computer.Name,
            DisplayName = ComputerDisplayName.From(computer),
            computer.Description, computer.Type, computer.Status,
            computer.AddedDate, computer.AddedUserId,
            AddedUserName = addedUserName,
            computer.BuilderUserId,
            BuilderName = builderName,
            computer.Location,
            computer.Price, computer.Tax, computer.OriginalPrice, computer.SoldDate,
            computer.CustomerName, computer.CustomerUrl, computer.ConversationUrl, computer.CustomerInfo,
            computer.CustomerAddress1, computer.CustomerAddress2, computer.CustomerCity,
            computer.CustomerState, computer.CustomerZip, computer.TrackingNumber, computer.TrackingStatus,
            computer.Notes, computer.ExpectedCompletionDate, computer.IgnoreIncomplete,
            computer.BulkDesc, computer.BulkCost,
            PartsCost = partsCost,
            NetPaid = netPaid,
            PaymentFees = paymentFees,
            HasDeposit = computer.Payments.Any(p => p.Type == "deposit"),
            HasPayment = computer.Payments.Any(p => p.Type == "payment"),
            Profit = profit,
            WagesBranden = wagesBranden,
            WagesJosh = wagesJosh,
            ProfitBen = profit - wagesBranden - wagesJosh,
            WagesNonJosh = wagesNonJosh,
            JoshSharePercentage = joshSharePercentage,
            BenProfit = BenProfitOf(profit, wagesNonJosh + wagesJosh, wagesBenL),
            IsShipping = !string.IsNullOrEmpty(computer.TrackingNumber)
                         || !string.IsNullOrEmpty(computer.CustomerAddress1),
            MissingRequiredTypes = missingRequired,
            HasWrongLocationParts = hasWrongLocationParts,
            ShareBase = shareBase,
            Parts = computer.Parts.OrderByPartType(p => p.Type).ToList(),
            Placeholders = computer.Placeholders
                .OrderByPartType(p => p.Type)
                .Select(PartSlotService.ToDto)
                .ToList(),
            Payments = computer.Payments.OrderBy(p => p.Date).ToList(),
            Wages = computer.Wages
                .OrderByDescending(w => w.PaidDate)
                .ThenByDescending(w => w.Id)
                .ToList(),
            Shares = computer.Shares
                .OrderBy(s => s.Id)
                .Select(s => new
                {
                    s.Id,
                    s.ComputerId,
                    s.BuilderUserId,
                    BuilderName = shareUserNames.TryGetValue(s.BuilderUserId, out var sn) ? sn : null,
                    s.Percentage,
                    Amount = MoneyMath.Round2(shareBase * (s.Percentage / 100m))
                })
                .ToList()
        };
    }

    /// <summary>Public view - no auth required. Only name, expected completion, and parts.</summary>
    [HttpGet("{id:int}/public")]
    [AllowAnonymous]
    public async Task<ActionResult<object>> GetPublicComputer(int id)
    {
        var computer = await _db.Computers
            .Include(c => c.Parts)
            .FirstOrDefaultAsync(c => c.Id == id);
        if (computer is null) return NotFound();

        return new
        {
            Name = ComputerDisplayName.From(computer),
            computer.ExpectedCompletionDate,
            Parts = computer.Parts
                .OrderByPartType(p => p.Type)
                .Select(p => new { p.Type, p.Manufacturer, p.ModelNumber, p.Color, p.HasRgb })
                .ToList()
        };
    }

    [HttpPost]
    public async Task<ActionResult<Computer>> CreateComputer(Computer computer)
    {
        computer.Id = 0;
        var error = await Validate(computer);
        if (error is not null) return BadRequest(new { message = error });

        computer.AddedDate = DateTime.UtcNow;
        computer.AddedUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        // Attach any parts by id
        var partIds = computer.Parts.Select(p => p.Id).ToList();
        computer.Parts = new List<Part>();
        computer.Payments = new List<Payment>();

        _db.Computers.Add(computer);
        await _db.SaveChangesAsync();

        if (partIds.Count > 0)
        {
            var parts = await _db.Parts.Where(p => partIds.Contains(p.Id)).ToListAsync();
            foreach (var p in parts)
            {
                if (p.ComputerId is not null && p.ComputerId != computer.Id)
                    return BadRequest(new { message = $"Part {p.Id} is already assigned to another computer." });
                p.ComputerId = computer.Id;
            }
            if (StatusesThatConfirmParts.Contains(computer.Status))
                await MarkAssignedPartsReceivedAndTestedAsync(computer.Id);
            await _db.SaveChangesAsync();
        }

        return CreatedAtAction(nameof(GetComputer), new { id = computer.Id }, computer);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<Computer>> UpdateComputer(int id, Computer computer)
    {
        var existing = await _db.Computers.FindAsync(id);
        if (existing is null) return NotFound();

        var error = await Validate(computer);
        if (error is not null) return BadRequest(new { message = error });

        existing.Name = computer.Name;
        existing.Description = computer.Description;
        existing.Type = computer.Type;
        existing.Status = computer.Status;
        existing.BuilderUserId = computer.BuilderUserId;
        var locationChanged = !string.Equals(existing.Location, computer.Location, StringComparison.Ordinal);
        existing.Location = computer.Location;
        existing.IgnoreIncomplete = computer.IgnoreIncomplete;
        existing.Price = computer.Price;
        existing.Tax = computer.Tax;
        existing.OriginalPrice = computer.OriginalPrice;
        existing.BulkDesc = computer.BulkDesc;
        existing.BulkCost = computer.BulkCost;
        existing.SoldDate = computer.SoldDate;
        existing.CustomerName = computer.CustomerName;
        existing.CustomerUrl = computer.CustomerUrl;
        existing.ConversationUrl = computer.ConversationUrl;
        existing.CustomerInfo = computer.CustomerInfo;
        existing.CustomerAddress1 = computer.CustomerAddress1;
        existing.CustomerAddress2 = computer.CustomerAddress2;
        existing.CustomerCity = computer.CustomerCity;
        existing.CustomerState = computer.CustomerState;
        existing.CustomerZip = computer.CustomerZip;
        existing.TrackingNumber = computer.TrackingNumber;
        existing.TrackingStatus = computer.TrackingStatus;
        existing.Notes = computer.Notes;
        existing.ExpectedCompletionDate = computer.ExpectedCompletionDate;

        if (StatusesThatConfirmParts.Contains(existing.Status))
            await MarkAssignedPartsReceivedAndTestedAsync(id);

        if (locationChanged && StatusesThatConfirmParts.Contains(existing.Status))
            await SyncAssignedPartsLocationAsync(id, existing.Location);

        await _db.SaveChangesAsync();
        return existing;
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> DeleteComputer(int id)
    {
        var computer = await _db.Computers.Include(c => c.Parts).FirstOrDefaultAsync(c => c.Id == id);
        if (computer is null) return NotFound();

        // Release parts back to inventory
        foreach (var part in computer.Parts)
            part.ComputerId = null;

        _db.Computers.Remove(computer);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Replaces the computer's parts list with the given part ids.</summary>
    [HttpPost("{id:int}/parts")]
    public async Task<ActionResult> AssignParts(int id, AssignPartsRequest request)
    {
        var computer = await _db.Computers.Include(c => c.Parts).FirstOrDefaultAsync(c => c.Id == id);
        if (computer is null) return NotFound();

        var newParts = await _db.Parts.Include(p => p.Computer)
            .Where(p => request.PartIds.Contains(p.Id)).ToListAsync();

        // Parts on another computer may only be taken from a Planned one.
        var conflict = newParts.FirstOrDefault(p =>
            p.ComputerId is not null && p.ComputerId != id && p.Computer?.Status != "Planned");
        if (conflict is not null)
            return BadRequest(new { message = $"Part '{conflict.Manufacturer} {conflict.ModelNumber}' is already assigned to another computer." });

        // Remove parts no longer assigned
        foreach (var part in computer.Parts.Where(p => !request.PartIds.Contains(p.Id)).ToList())
            part.ComputerId = null;

        // Assign new parts
        foreach (var part in newParts)
            part.ComputerId = id;

        // Parts added after Built/Active/Sold should match the confirmed inventory state.
        if (StatusesThatConfirmParts.Contains(computer.Status))
            await MarkAssignedPartsReceivedAndTestedAsync(id);

        await _db.SaveChangesAsync();
        return Ok();
    }

    [HttpPost("{id:int}/placeholders")]
    public async Task<ActionResult<object>> AddPlaceholder(int id, PlaceholderRequest request)
    {
        if (!await _db.Computers.AnyAsync(c => c.Id == id)) return NotFound();
        var (ph, error) = await _slots.AddPlaceholderAsync(id, request);
        if (error is not null) return BadRequest(new { message = error });
        return Ok(PartSlotService.ToDto(ph!));
    }

    [HttpPut("{id:int}/placeholders/{phId:int}")]
    public async Task<ActionResult<object>> UpdatePlaceholder(int id, int phId, PlaceholderRequest request)
    {
        var (ph, error) = await _slots.UpdatePlaceholderAsync(id, phId, request);
        if (error == "notfound") return NotFound();
        if (error is not null) return BadRequest(new { message = error });
        return Ok(PartSlotService.ToDto(ph!));
    }

    [HttpDelete("{id:int}/placeholders/{phId:int}")]
    public async Task<ActionResult> DeletePlaceholder(int id, int phId)
    {
        var error = await _slots.DeletePlaceholderAsync(id, phId);
        if (error == "notfound") return NotFound();
        return NoContent();
    }

    [HttpPost("{id:int}/placeholders/{phId:int}/replace")]
    public async Task<ActionResult> ReplacePlaceholder(int id, int phId, ReplaceWithPartRequest request)
    {
        var error = await _slots.ReplacePlaceholderWithPartAsync(id, phId, request.PartId);
        if (error == "notfound") return NotFound();
        if (error is not null) return BadRequest(new { message = error });
        return Ok();
    }

    [HttpPost("{id:int}/parts/{partId:int}/replace-with-placeholder")]
    public async Task<ActionResult<object>> ReplacePartWithPlaceholder(
        int id, int partId, ReplaceWithPlaceholderRequest request)
    {
        var (ph, error) = await _slots.ReplacePartWithPlaceholderAsync(id, partId, request.Description);
        if (error == "notfound") return NotFound();
        if (error is not null) return BadRequest(new { message = error });
        return Ok(PartSlotService.ToDto(ph!));
    }

    [HttpPost("{id:int}/parts/{partId:int}/replace-with-part")]
    public async Task<ActionResult> ReplacePartWithPart(int id, int partId, ReplacePartWithPartRequest request)
    {
        var error = await _slots.ReplacePartWithPartAsync(id, partId, request.NewPartId);
        if (error == "notfound") return NotFound();
        if (error is not null) return BadRequest(new { message = error });
        return Ok();
    }

    [HttpPost("{id:int}/payments")]
    public async Task<ActionResult<Payment>> AddPayment(int id, AddPaymentRequest request)
    {
        var computer = await _db.Computers.Include(c => c.Payments).FirstOrDefaultAsync(c => c.Id == id);
        if (computer is null) return NotFound();

        if (request.Type is not ("payment" or "deposit" or "refund"))
            return BadRequest(new { message = "Payment type must be 'payment', 'deposit', or 'refund'." });

        // Optional customer fields belong on the Computer, never on Payment.
        if (request.CustomerName is not null
            || request.CustomerUrl is not null
            || request.ConversationUrl is not null)
        {
            computer.CustomerName = NormalizeOptional(request.CustomerName);
            computer.CustomerUrl = NormalizeOptional(request.CustomerUrl);
            computer.ConversationUrl = NormalizeOptional(request.ConversationUrl);
        }

        var payment = new Payment
        {
            ComputerId = id,
            Amount = MoneyMath.Round2(request.Amount),
            Tax = request.Tax is null ? null : MoneyMath.Round2(request.Tax.Value),
            Fee = request.Fee is null ? null : MoneyMath.Round2(request.Fee.Value),
            Method = request.Method,
            Date = request.Date,
            PaymentUrl = request.PaymentUrl,
            Type = request.Type
        };
        // Add via the navigation only. Also calling _db.Payments.Add causes EF
        // relationship fixup to insert the same instance twice into Payments,
        // which double-counted Amount/Tax when rolling up a payoff.
        computer.Payments.Add(payment);

        // Price is tax-inclusive (Payment.Amount is likewise the full customer
        // payment); Tax on Computer/Payment is the tax portion, not an add-on.
        var netPaid = computer.Payments.Sum(p => p.Type == "refund" ? -p.Amount : p.Amount);
        var totalDue = computer.Price ?? 0;
        var fullyPaid = totalDue > 0 && netPaid >= totalDue;

        // Only roll payment tax up to the computer once it's fully paid.
        // Partial payments leave Computer.Tax unchanged (e.g. estimated tax).
        // Use tax-of-total (not Σ rounded per-payment taxes) so pretax + tax
        // equals the money collected without a phantom penny.
        if (fullyPaid)
            computer.Tax = RollupTaxWhenFullyPaid(computer.Payments, netPaid);

        if (computer.Status != "Sold" && fullyPaid)
        {
            computer.Status = "Sold";
            computer.SoldDate ??= DateTime.UtcNow;
            await MarkAssignedPartsReceivedAndTestedAsync(id);
        }

        await _db.SaveChangesAsync();
        return payment;
    }

    private static string? NormalizeOptional(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    [HttpDelete("{id:int}/payments/{paymentId:int}")]
    public async Task<ActionResult> DeletePayment(int id, int paymentId)
    {
        var computer = await _db.Computers.Include(c => c.Payments).FirstOrDefaultAsync(c => c.Id == id);
        if (computer is null) return NotFound();

        var payment = computer.Payments.FirstOrDefault(p => p.Id == paymentId);
        if (payment is null) return NotFound();

        computer.Payments.Remove(payment);
        _db.Payments.Remove(payment);

        // Keep Computer.Tax in sync with payments only while still fully paid.
        var netPaid = computer.Payments.Sum(p => p.Type == "refund" ? -p.Amount : p.Amount);
        var totalDue = computer.Price ?? 0;
        if (totalDue > 0 && netPaid >= totalDue)
            computer.Tax = RollupTaxWhenFullyPaid(computer.Payments, netPaid);

        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Net tax portion from payments (refund tax subtracts).</summary>
    private static decimal? SumPaymentTax(IEnumerable<Payment> payments)
    {
        var total = payments.Sum(p =>
        {
            var tax = p.Tax ?? 0;
            return p.Type == "refund" ? -tax : tax;
        });
        return total == 0 && !payments.Any(p => p.Tax != null) ? null : total;
    }

    /// <summary>
    /// When fully paid: keep exempt (null/0) if no payment carried tax; otherwise
    /// tax of the net collected total so cents match the inclusive amount.
    /// </summary>
    private static decimal? RollupTaxWhenFullyPaid(IEnumerable<Payment> payments, decimal netPaid)
    {
        var summed = SumPaymentTax(payments);
        if (summed is null || summed == 0)
            return summed;
        return MoneyMath.TaxFromInclusiveAmount(netPaid);
    }

    [HttpPost("{id:int}/status")]
    public async Task<ActionResult> SetStatus(int id, LookupValue value)
    {
        var computer = await _db.Computers.FindAsync(id);
        if (computer is null) return NotFound();
        if (string.IsNullOrWhiteSpace(value.Name) || !ValidStatuses.Contains(value.Name))
            return BadRequest(new { message = $"Status must be one of: {string.Join(", ", ValidStatuses)}." });

        computer.Status = value.Name;
        if (value.Name == "Sold")
            computer.SoldDate ??= DateTime.UtcNow;
        if (StatusesThatConfirmParts.Contains(value.Name))
            await MarkAssignedPartsReceivedAndTestedAsync(id);

        await _db.SaveChangesAsync();
        return Ok(new { computer.Status, computer.SoldDate });
    }

    [HttpPost("{id:int}/location")]
    public async Task<ActionResult> SetLocation(int id, LookupValue value)
    {
        var computer = await _db.Computers.FindAsync(id);
        if (computer is null) return NotFound();
        if (!string.IsNullOrEmpty(value.Name) && !await _db.Locations.AnyAsync(l => l.Name == value.Name))
            return BadRequest(new { message = $"Unknown location '{value.Name}'." });

        computer.Location = string.IsNullOrEmpty(value.Name) ? null : value.Name;
        if (StatusesThatConfirmParts.Contains(computer.Status))
            await SyncAssignedPartsLocationAsync(id, computer.Location);

        await _db.SaveChangesAsync();
        return Ok();
    }

    [HttpPost("{id:int}/builder")]
    public async Task<ActionResult> SetBuilder(int id, LookupValue value)
    {
        var computer = await _db.Computers.FindAsync(id);
        if (computer is null) return NotFound();

        string? builderId = string.IsNullOrEmpty(value.Name) ? null : value.Name;
        string? builderName = null;
        if (builderId is not null)
        {
            var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == builderId);
            if (user is null)
                return BadRequest(new { message = $"Unknown builder user '{builderId}'." });
            builderName = user.Name;
        }

        computer.BuilderUserId = builderId;
        await _db.SaveChangesAsync();
        return Ok(new { builderUserId = builderId, builderName });
    }

    [HttpPost("{id:int}/price")]
    public async Task<ActionResult> SetPrice(int id, SetComputerPriceRequest request)
    {
        var computer = await _db.Computers.FindAsync(id);
        if (computer is null) return NotFound();

        computer.Price = request.Price is null ? null : MoneyMath.Round2(request.Price.Value);
        // Same tax-inclusive formula as payment / new-computer entry.
        computer.Tax = MoneyMath.TaxFromInclusiveAmount(computer.Price);
        await _db.SaveChangesAsync();
        return Ok(new { price = computer.Price, tax = computer.Tax });
    }

    private async Task<string?> Validate(Computer computer)
    {
        computer.Name = computer.Name?.Trim() ?? "";
        if (!ValidTypes.Contains(computer.Type))
            return $"Type must be one of: {string.Join(", ", ValidTypes)}.";
        if (!ValidStatuses.Contains(computer.Status))
            return $"Status must be one of: {string.Join(", ", ValidStatuses)}.";
        if (computer.Location is not null && !await _db.Locations.AnyAsync(l => l.Name == computer.Location))
            return $"Unknown location '{computer.Location}'.";
        if (computer.BuilderUserId is not null && !await _db.Users.AnyAsync(u => u.Id == computer.BuilderUserId))
            return $"Unknown builder user '{computer.BuilderUserId}'.";
        return null;
    }

    /// <summary>
    /// Marks all inventory parts on the computer as received and tested.
    /// Existing TestedDate values are left unchanged.
    /// </summary>
    private async Task MarkAssignedPartsReceivedAndTestedAsync(int computerId)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var now = DateTime.UtcNow;
        var parts = await _db.Parts.Where(p => p.ComputerId == computerId).ToListAsync();
        foreach (var part in parts)
        {
            part.Received = true;
            if (part.TestedDate is null)
            {
                part.TestedDate = now;
                part.TestedUserId = userId;
            }
        }
    }

    /// <summary>
    /// Sets every assigned part's location to match the computer (Built / Active / Sold).
    /// </summary>
    private async Task SyncAssignedPartsLocationAsync(int computerId, string? location)
    {
        var parts = await _db.Parts.Where(p => p.ComputerId == computerId).ToListAsync();
        foreach (var part in parts)
            part.Location = location;
    }
}
