using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BenBotInventory.Server.Controllers;

public record MarkTestedRequest(bool Tested);

/// <summary>Mark received; optionally reclassify a New part as Used when it looks used.</summary>
public record MarkReceivedRequest(bool Received, bool AppearsUsed = false);

/// <summary>Check-off test outcome: good | possiblyBad | definitelyBad | scam</summary>
public record CheckOffTestRequest(string Outcome, string? Notes);

/// <summary>Split one part row into <see cref="Quantity"/> identical unit rows.</summary>
public record SplitPartRequest(int Quantity, string? ModelNumber);

/// <summary>One reviewed draft to create; optional listing image from PDF parse.</summary>
public class ImportParsedPartDto
{
    public string Type { get; set; } = null!;
    public string? Manufacturer { get; set; }
    public string? ModelNumber { get; set; }
    public decimal? Cost { get; set; }
    public DateTime? OrderDate { get; set; }
    public string? OrderUrl { get; set; }
    public string? Seller { get; set; }
    public string? Color { get; set; }
    public bool HasRgb { get; set; }
    public string? CpuSocket { get; set; }
    public string? PcieGen { get; set; }
    public string? RamType { get; set; }
    public string? Location { get; set; }
    public bool Received { get; set; }
    public string? Condition { get; set; }
    public DateTime? ReturnByDate { get; set; }
    public string? Merchant { get; set; }
    public string? Notes { get; set; }
    public int? Bad { get; set; }
    public int? Scam { get; set; }
    public int? Lost { get; set; }
    /// <summary>data:image/...;base64,... from PDF extract (optional).</summary>
    public string? ImageDataUrl { get; set; }
}

/// <summary>Create parts previously reviewed after PDF parse.</summary>
public record ImportParsedPartsRequest(List<ImportParsedPartDto> Parts);

[ApiController]
[Route("api/parts")]
[Authorize(Policy = PermissionPolicies.Level2)]
public class PartsController : ControllerBase
{
    private const long MaxImageBytes = 12 * 1024 * 1024; // 12 MB
    private const long MaxPdfBytes = 15 * 1024 * 1024; // 15 MB per file
    private const int MaxPdfFiles = 25;
    private static readonly HashSet<string> AllowedImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"
    };
    private static readonly HashSet<string> AllowedImageSources = new(StringComparer.OrdinalIgnoreCase)
    {
        "import", "receiving", "testing"
    };

    private readonly AppDbContext _db;
    private readonly EbayOrderPdfParser _ebayPdfParser;

    public PartsController(AppDbContext db, EbayOrderPdfParser ebayPdfParser)
    {
        _db = db;
        _ebayPdfParser = ebayPdfParser;
    }

    /// <summary>
    /// Search/list parts. All filters optional.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetParts(
        [FromQuery] string? type,
        [FromQuery] string? search,
        [FromQuery] string? seller,
        [FromQuery] string? manufacturer,
        [FromQuery] string? model,
        [FromQuery] string? ramType,
        [FromQuery] string? pcieGen,
        [FromQuery] string? cpuSocket,
        [FromQuery] string? location,
        [FromQuery] DateTime? orderDateFrom,
        [FromQuery] DateTime? orderDateTo,
        [FromQuery] bool? unassigned,
        [FromQuery] bool? includePlanned,
        [FromQuery] bool? excludeSold,
        [FromQuery] bool? excludeConfirmedBad,
        [FromQuery] bool? excludeBad,
        [FromQuery] bool? excludeScam,
        [FromQuery] bool? notReceived,
        [FromQuery] bool? needsTesting,
        [FromQuery] bool? needsTransfer)
    {
        var query = _db.Parts.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(type)) query = query.Where(p => p.Type == type);
        if (!string.IsNullOrWhiteSpace(seller)) query = query.Where(p => p.Seller == seller);
        if (!string.IsNullOrWhiteSpace(manufacturer)) query = query.Where(p => p.Manufacturer!.Contains(manufacturer));
        if (!string.IsNullOrWhiteSpace(model)) query = query.Where(p => p.ModelNumber!.Contains(model));
        if (!string.IsNullOrWhiteSpace(ramType)) query = query.Where(p => p.RamType == ramType);
        if (!string.IsNullOrWhiteSpace(pcieGen)) query = query.Where(p => p.PcieGen == pcieGen);
        if (!string.IsNullOrWhiteSpace(cpuSocket)) query = query.Where(p => p.CpuSocket == cpuSocket);
        if (!string.IsNullOrWhiteSpace(location))
            query = query.Where(p => p.Location == location);
        if (orderDateFrom.HasValue) query = query.Where(p => p.OrderDate >= orderDateFrom);
        if (orderDateTo.HasValue) query = query.Where(p => p.OrderDate <= orderDateTo);
        if (unassigned == true)
        {
            // includePlanned: also offer parts sitting on Planned computers (reassignable).
            query = includePlanned == true
                ? query.Where(p => p.ComputerId == null || p.Computer!.Status == "Planned")
                : query.Where(p => p.ComputerId == null);
        }
        // When listing assigned parts, optionally hide those on Sold computers.
        if (excludeSold == true)
            query = query.Where(p => p.ComputerId == null || p.Computer!.Status != "Sold");
        // Check-off lists: skip parts on Built / Active / Sold builds.
        if (notReceived == true || needsTesting == true || needsTransfer == true)
        {
            query = query.Where(p =>
                p.ComputerId == null
                || p.Computer == null
                || (p.Computer.Status != "Built"
                    && p.Computer.Status != "Active"
                    && p.Computer.Status != "Sold"));
        }
        // Bad: 1 = possibly bad, 2 = confirmed bad.
        if (excludeBad == true)
            query = query.Where(p => p.Bad == null || p.Bad == 0);
        else if (excludeConfirmedBad == true)
            query = query.Where(p => p.Bad != 2);
        // Scam: 1 = possibly scam, 2 = confirmed scam.
        if (excludeScam == true)
            query = query.Where(p => p.Scam == null || p.Scam == 0);
        if (notReceived == true) query = query.Where(p => !p.Received);
        // Received used parts that still need testing.
        if (needsTesting == true)
            query = query.Where(p => p.Received && p.Condition == "Used" && p.TestedDate == null);
        // Assigned parts whose location differs from their build/computer location.
        if (needsTransfer == true)
        {
            query = query.Where(p =>
                p.ComputerId != null
                && p.Computer != null
                && p.Computer.Location != null
                && p.Computer.Location != ""
                && ((p.Location ?? "").Trim().ToLower() != p.Computer.Location.Trim().ToLower()));
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(p =>
                p.Manufacturer!.Contains(search) ||
                p.ModelNumber!.Contains(search) ||
                p.Type.Contains(search) ||
                p.Seller!.Contains(search) ||
                (p.OrderUrl != null && p.OrderUrl.Contains(search)));
        }

        var parts = await query
            .Select(p => new
            {
                p.Id, p.Type, p.Manufacturer, p.ModelNumber, p.Cost, p.OrderDate, p.OrderUrl,
                p.Seller, p.Color, p.HasRgb, p.CpuSocket, p.PcieGen, p.RamType, p.Location,
                p.Received, p.TestedDate, p.TestedUserId, p.Condition, p.ReturnByDate,
                p.Merchant, p.Notes, p.Bad, p.Scam, p.Lost,
                p.ComputerId,

                ComputerName = p.Computer != null ? p.Computer.Name : null,
                ComputerStatus = p.Computer != null ? p.Computer.Status : null,
                ComputerLocation = p.Computer != null ? p.Computer.Location : null
            })
            .ToListAsync();

        var assignedIds = parts.Where(p => p.ComputerId != null).Select(p => p.ComputerId!.Value);
        var nameMap = await ComputerDisplayName.MapAsync(_db, assignedIds);

        return Ok(parts
            .OrderBy(p => PartTypeOrder.Rank(p.Type))
            .ThenBy(p => p.Type, StringComparer.OrdinalIgnoreCase)
            .ThenBy(p => p.Manufacturer)
            .ThenBy(p => p.ModelNumber)
            .Select(p => new
            {
                p.Id, p.Type, p.Manufacturer, p.ModelNumber, p.Cost, p.OrderDate, p.OrderUrl,
                p.Seller, p.Color, p.HasRgb, p.CpuSocket, p.PcieGen, p.RamType, p.Location,
                p.Received, p.TestedDate, p.TestedUserId, p.Condition, p.ReturnByDate,
                p.Merchant, p.Notes, p.Bad, p.Scam, p.Lost,
                p.ComputerId,
                ComputerName = p.ComputerId != null && nameMap.TryGetValue(p.ComputerId.Value, out var n)
                    ? n
                    : p.ComputerName,
                p.ComputerStatus,
                p.ComputerLocation
            })
            .ToList());
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Part>> GetPart(int id)
    {
        var part = await _db.Parts.FindAsync(id);
        if (part is null) return NotFound();
        return part;
    }

    [HttpPost]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult<Part>> CreatePart(Part part)
    {
        part.Id = 0;
        // Default: eBay -> Used, everything else -> New
        if (string.IsNullOrWhiteSpace(part.Condition))
            part.Condition = string.Equals(part.Seller, "eBay", StringComparison.OrdinalIgnoreCase)
                ? "Used"
                : "New";

        var error = await ValidateLookups(part);
        if (error is not null) return BadRequest(new { message = error });

        _db.Parts.Add(part);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetPart), new { id = part.Id }, part);
    }

    /// <summary>
    /// Parse eBay order receipt PDFs in memory (files are not stored).
    /// Returns per-file drafts for review before create.
    /// </summary>
    [HttpPost("parse-order-pdfs")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    [RequestSizeLimit(MaxPdfBytes * MaxPdfFiles)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxPdfBytes * MaxPdfFiles)]
    public async Task<ActionResult<object>> ParseOrderPdfs([FromForm] List<IFormFile>? files)
    {
        if (files is null || files.Count == 0)
            return BadRequest(new { message = "No PDF files provided." });
        if (files.Count > MaxPdfFiles)
            return BadRequest(new { message = $"At most {MaxPdfFiles} PDFs per request." });

        var results = new List<ParseOrderPdfFileResult>();
        foreach (var file in files)
        {
            var name = file.FileName ?? "upload.pdf";
            if (file.Length <= 0)
            {
                results.Add(new ParseOrderPdfFileResult
                {
                    FileName = name,
                    Ok = false,
                    Error = "Empty file."
                });
                continue;
            }
            if (file.Length > MaxPdfBytes)
            {
                results.Add(new ParseOrderPdfFileResult
                {
                    FileName = name,
                    Ok = false,
                    Error = $"File exceeds {MaxPdfBytes / (1024 * 1024)} MB limit."
                });
                continue;
            }

            var isPdf = name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)
                || string.Equals(file.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase);
            if (!isPdf)
            {
                results.Add(new ParseOrderPdfFileResult
                {
                    FileName = name,
                    Ok = false,
                    Error = "File must be a PDF."
                });
                continue;
            }

            await using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            results.Add(_ebayPdfParser.Parse(ms.ToArray(), name));
        }

        await FlagDuplicateOrderDrafts(results);

        return Ok(new { files = results });
    }

    /// <summary>
    /// Marks drafts whose eBay order number already appears in an existing part's OrderUrl.
    /// </summary>
    private async Task FlagDuplicateOrderDrafts(List<ParseOrderPdfFileResult> results)
    {
        var orderIds = results
            .SelectMany(r => r.Drafts)
            .Select(d => d.OrderId)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Cast<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (orderIds.Count == 0)
            return;

        var existingUrls = await _db.Parts.AsNoTracking()
            .Where(p => p.OrderUrl != null && p.OrderUrl != "")
            .Select(p => p.OrderUrl!)
            .ToListAsync();

        if (existingUrls.Count == 0)
            return;

        var duplicateIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in orderIds)
        {
            if (existingUrls.Any(url => url.Contains(id, StringComparison.OrdinalIgnoreCase)))
                duplicateIds.Add(id);
        }

        if (duplicateIds.Count == 0)
            return;

        foreach (var draft in results.SelectMany(r => r.Drafts))
        {
            if (draft.OrderId is not null && duplicateIds.Contains(draft.OrderId))
                draft.IsDuplicate = true;
        }
    }

    /// <summary>
    /// Create parts after the user reviews/edits drafts from parse-order-pdfs.
    /// Optional ImageDataUrl on each item is stored as a PartImage (same as check-off upload).
    /// </summary>
    [HttpPost("import-parsed")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    [RequestSizeLimit(MaxPdfBytes * MaxPdfFiles)]
    public async Task<ActionResult<IEnumerable<Part>>> ImportParsedParts([FromBody] ImportParsedPartsRequest request)
    {
        if (request?.Parts is null || request.Parts.Count == 0)
            return BadRequest(new { message = "No parts to import." });
        if (request.Parts.Count > 200)
            return BadRequest(new { message = "Cannot import more than 200 parts at once." });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var created = new List<Part>();
        foreach (var dto in request.Parts)
        {
            var part = new Part
            {
                Type = dto.Type,
                Manufacturer = dto.Manufacturer,
                ModelNumber = dto.ModelNumber,
                Cost = dto.Cost,
                OrderDate = dto.OrderDate,
                OrderUrl = dto.OrderUrl,
                Seller = dto.Seller,
                Color = dto.Color,
                HasRgb = dto.HasRgb,
                CpuSocket = dto.CpuSocket,
                PcieGen = dto.PcieGen,
                RamType = dto.RamType,
                Location = dto.Location,
                Received = dto.Received,
                Condition = dto.Condition,
                ReturnByDate = dto.ReturnByDate,
                Merchant = dto.Merchant,
                Notes = dto.Notes,
                Bad = dto.Bad,
                Scam = dto.Scam,
                Lost = dto.Lost
            };

            if (string.IsNullOrWhiteSpace(part.Type))
                return BadRequest(new { message = "Each part must have a Type." });
            if (string.IsNullOrWhiteSpace(part.Seller))
                part.Seller = "eBay";
            if (string.IsNullOrWhiteSpace(part.Condition))
                part.Condition = string.Equals(part.Seller, "eBay", StringComparison.OrdinalIgnoreCase)
                    ? "Used"
                    : "New";

            var error = await ValidateLookups(part);
            if (error is not null) return BadRequest(new { message = error });

            if (!TryDecodeDataUrlImage(dto.ImageDataUrl, out var contentType, out var imageBytes, out var imageError))
                return BadRequest(new { message = imageError });

            _db.Parts.Add(part);
            created.Add(part);

            if (imageBytes is { Length: > 0 })
            {
                part.Images.Add(new PartImage
                {
                    ContentType = contentType!,
                    Data = imageBytes,
                    Source = "import",
                    CreatedDate = DateTime.UtcNow,
                    CreatedUserId = userId
                });
            }
        }

        await _db.SaveChangesAsync();
        return Ok(created);
    }

    /// <summary>
    /// Decode a data URL into image bytes. Empty/null is allowed (no image).
    /// </summary>
    private static bool TryDecodeDataUrlImage(
        string? dataUrl,
        out string? contentType,
        out byte[]? bytes,
        out string? error)
    {
        contentType = null;
        bytes = null;
        error = null;

        if (string.IsNullOrWhiteSpace(dataUrl))
            return true;

        // data:image/png;base64,....
        const string prefix = "data:";
        if (!dataUrl.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            error = "Invalid image data URL.";
            return false;
        }

        var comma = dataUrl.IndexOf(',');
        if (comma <= prefix.Length)
        {
            error = "Invalid image data URL.";
            return false;
        }

        var meta = dataUrl[prefix.Length..comma];
        var payload = dataUrl[(comma + 1)..];
        if (!meta.Contains(";base64", StringComparison.OrdinalIgnoreCase))
        {
            error = "Image data URL must be base64-encoded.";
            return false;
        }

        var semi = meta.IndexOf(';');
        contentType = semi > 0 ? meta[..semi] : meta;
        if (string.IsNullOrWhiteSpace(contentType)
            || (!AllowedImageTypes.Contains(contentType)
                && !contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)))
        {
            error = "Unsupported image type from PDF.";
            return false;
        }

        try
        {
            bytes = Convert.FromBase64String(payload);
        }
        catch (FormatException)
        {
            error = "Could not decode listing image.";
            return false;
        }

        if (bytes.Length == 0)
        {
            bytes = null;
            return true;
        }

        if (bytes.Length > MaxImageBytes)
        {
            error = "Listing image exceeds 12 MB limit.";
            return false;
        }

        return true;
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult<Part>> UpdatePart(int id, Part part)
    {
        var existing = await _db.Parts.FindAsync(id);
        if (existing is null) return NotFound();

        var error = await ValidateLookups(part);
        if (error is not null) return BadRequest(new { message = error });

        existing.Type = part.Type;
        existing.Manufacturer = part.Manufacturer;
        existing.ModelNumber = part.ModelNumber;
        existing.Cost = part.Cost;
        existing.OrderDate = part.OrderDate;
        existing.OrderUrl = part.OrderUrl;
        existing.Seller = part.Seller;
        existing.Color = part.Color;
        existing.HasRgb = part.HasRgb;
        existing.CpuSocket = part.CpuSocket;
        existing.PcieGen = part.PcieGen;
        existing.RamType = part.RamType;
        existing.Location = part.Location;
        existing.Received = part.Received;
        existing.TestedDate = part.TestedDate;
        existing.TestedUserId = part.TestedUserId;
        existing.Condition = part.Condition;
        existing.ReturnByDate = part.ReturnByDate;
        existing.Merchant = part.Merchant;
        existing.Notes = part.Notes;
        existing.Bad = part.Bad;
        existing.Scam = part.Scam;
        existing.Lost = part.Lost;

        await _db.SaveChangesAsync();
        return existing;
    }

    [HttpDelete("{id:int}")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult> DeletePart(int id)
    {
        var part = await _db.Parts.FindAsync(id);
        if (part is null) return NotFound();
        _db.Parts.Remove(part);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Split a bulk purchase row into <paramref name="request"/>.Quantity unit rows.
    /// The original row becomes the first unit; additional clones are inserted.
    /// Cost is divided in cents so unit costs sum exactly to the original total.
    /// </summary>
    [HttpPost("{id:int}/split")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult<IEnumerable<Part>>> SplitPart(int id, [FromBody] SplitPartRequest request)
    {
        if (request.Quantity < 2)
            return BadRequest(new { message = "Quantity must be at least 2." });
        if (request.Quantity > 500)
            return BadRequest(new { message = "Quantity cannot exceed 500." });

        var modelNumber = request.ModelNumber?.Trim();
        if (string.IsNullOrWhiteSpace(modelNumber))
            return BadRequest(new { message = "A part name (model number) is required for the split parts." });
        if (modelNumber.Length > 100)
            return BadRequest(new { message = "Part name cannot exceed 100 characters." });

        var source = await _db.Parts.FindAsync(id);
        if (source is null) return NotFound();
        if (source.Cost is null)
            return BadRequest(new { message = "Part must have a cost before it can be split." });

        var costs = SplitCostCents(source.Cost.Value, request.Quantity);
        source.Cost = costs[0];
        source.ModelNumber = modelNumber;

        var created = new List<Part>(request.Quantity - 1);
        for (var i = 1; i < request.Quantity; i++)
        {
            var clone = ClonePartAsUnit(source, costs[i]);
            _db.Parts.Add(clone);
            created.Add(clone);
        }

        await _db.SaveChangesAsync();

        var result = new List<Part>(request.Quantity) { source };
        result.AddRange(created);
        return Ok(result);
    }

    /// <summary>
    /// Divide <paramref name="total"/> across <paramref name="quantity"/> shares in cents.
    /// The first (totalCents % quantity) shares get one extra cent.
    /// </summary>
    internal static List<decimal> SplitCostCents(decimal total, int quantity)
    {
        var totalCents = (long)Math.Round(total * 100m, MidpointRounding.AwayFromZero);
        var baseCents = totalCents / quantity;
        var remainder = totalCents % quantity;
        var costs = new List<decimal>(quantity);
        for (var i = 0; i < quantity; i++)
        {
            var cents = baseCents + (i < remainder ? 1 : 0);
            costs.Add(cents / 100m);
        }
        return costs;
    }

    private static Part ClonePartAsUnit(Part source, decimal unitCost) => new()
    {
        Type = source.Type,
        Manufacturer = source.Manufacturer,
        ModelNumber = source.ModelNumber,
        Cost = unitCost,
        OrderDate = source.OrderDate,
        OrderUrl = source.OrderUrl,
        Seller = source.Seller,
        Color = source.Color,
        HasRgb = source.HasRgb,
        CpuSocket = source.CpuSocket,
        PcieGen = source.PcieGen,
        RamType = source.RamType,
        Location = source.Location,
        Received = source.Received,
        TestedDate = source.TestedDate,
        TestedUserId = source.TestedUserId,
        Condition = source.Condition,
        ReturnByDate = source.ReturnByDate,
        Merchant = source.Merchant,
        Notes = source.Notes,
        Bad = source.Bad,
        Scam = source.Scam,
        Lost = source.Lost,
        ComputerId = source.ComputerId
    };

    [HttpPost("{id:int}/received")]
    public async Task<ActionResult> MarkReceived(int id, [FromBody] MarkReceivedRequest request)
    {
        var part = await _db.Parts.FindAsync(id);
        if (part is null) return NotFound();
        part.Received = request.Received;
        if (request.Received && request.AppearsUsed)
        {
            if (!await _db.Conditions.AnyAsync(c => c.Name == "Used"))
                return BadRequest(new { message = "Condition 'Used' is not configured." });
            part.Condition = "Used";
        }
        await _db.SaveChangesAsync();
        return Ok(new { part.Id, part.Received, part.Condition });
    }

    [HttpPost("{id:int}/tested")]
    public async Task<ActionResult> MarkTested(int id, [FromBody] MarkTestedRequest request)
    {
        var part = await _db.Parts.FindAsync(id);
        if (part is null) return NotFound();

        if (request.Tested)
        {
            part.TestedDate = DateTime.UtcNow;
            part.TestedUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        }
        else
        {
            part.TestedDate = null;
            part.TestedUserId = null;
        }
        await _db.SaveChangesAsync();
        return Ok(new { part.Id, part.TestedDate, part.TestedUserId });
    }

    /// <summary>
    /// Parts Check Off: mark a used part as tested with a quality outcome, optional notes.
    /// </summary>
    [HttpPost("{id:int}/check-off/test")]
    public async Task<ActionResult> CheckOffTest(int id, [FromBody] CheckOffTestRequest request)
    {
        var part = await _db.Parts.FindAsync(id);
        if (part is null) return NotFound();

        var outcome = (request.Outcome ?? "").Trim().ToLowerInvariant();
        switch (outcome)
        {
            case "good":
                part.Bad = null;
                part.Scam = null;
                break;
            case "possiblybad":
            case "possibly_bad":
                part.Bad = 1;
                part.Scam = null;
                break;
            case "definitelybad":
            case "definitely_bad":
                part.Bad = 2;
                part.Scam = null;
                break;
            case "scam":
                part.Scam = 1;
                break;
            default:
                return BadRequest(new { message = "Outcome must be good, possiblyBad, definitelyBad, or scam." });
        }

        part.TestedDate = DateTime.UtcNow;
        part.TestedUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (request.Notes is not null)
            part.Notes = request.Notes;

        await _db.SaveChangesAsync();
        return Ok(new { part.Id, part.TestedDate, part.Bad, part.Scam, part.Notes });
    }

    [HttpGet("{id:int}/images")]
    public async Task<ActionResult<IEnumerable<object>>> ListImages(int id)
    {
        if (!await _db.Parts.AnyAsync(p => p.Id == id)) return NotFound();

        var images = await _db.PartImages.AsNoTracking()
            .Where(i => i.PartId == id)
            .OrderBy(i => i.CreatedDate)
            .Select(i => new
            {
                i.Id,
                i.PartId,
                i.ContentType,
                i.Source,
                i.CreatedDate,
                i.CreatedUserId
            })
            .ToListAsync();
        return images;
    }

    [HttpGet("{id:int}/images/{imageId:int}")]
    public async Task<IActionResult> GetImage(int id, int imageId)
    {
        var image = await _db.PartImages.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == imageId && i.PartId == id);
        if (image is null) return NotFound();
        return File(image.Data, image.ContentType);
    }

    [HttpPost("{id:int}/images")]
    [RequestSizeLimit(MaxImageBytes)]
    public async Task<ActionResult<object>> UploadImage(int id, IFormFile file, [FromForm] string? source = null)
    {
        if (!await _db.Parts.AnyAsync(p => p.Id == id)) return NotFound();
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "No image file provided." });
        if (file.Length > MaxImageBytes)
            return BadRequest(new { message = "Image must be 12 MB or smaller." });

        var contentType = string.IsNullOrWhiteSpace(file.ContentType) ? "image/jpeg" : file.ContentType;
        if (!AllowedImageTypes.Contains(contentType)
            && !contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "File must be an image." });

        string? normalizedSource = null;
        if (!string.IsNullOrWhiteSpace(source))
        {
            normalizedSource = source.Trim().ToLowerInvariant();
            if (!AllowedImageSources.Contains(normalizedSource))
                return BadRequest(new { message = "Image source must be import, receiving, or testing." });
        }

        await using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        var image = new PartImage
        {
            PartId = id,
            ContentType = contentType,
            Data = ms.ToArray(),
            Source = normalizedSource,
            CreatedDate = DateTime.UtcNow,
            CreatedUserId = User.FindFirstValue(ClaimTypes.NameIdentifier)
        };
        _db.PartImages.Add(image);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            image.Id,
            image.PartId,
            image.ContentType,
            image.Source,
            image.CreatedDate,
            image.CreatedUserId
        });
    }

    [HttpDelete("{id:int}/images/{imageId:int}")]
    public async Task<ActionResult> DeleteImage(int id, int imageId)
    {
        var image = await _db.PartImages.FirstOrDefaultAsync(i => i.Id == imageId && i.PartId == id);
        if (image is null) return NotFound();
        _db.PartImages.Remove(image);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:int}/location")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult> SetLocation(int id, LookupValue value)
    {
        var part = await _db.Parts.FindAsync(id);
        if (part is null) return NotFound();
        if (!string.IsNullOrEmpty(value.Name) && !await _db.Locations.AnyAsync(l => l.Name == value.Name))
            return BadRequest(new { message = $"Unknown location '{value.Name}'." });
        part.Location = string.IsNullOrEmpty(value.Name) ? null : value.Name;
        await _db.SaveChangesAsync();
        return Ok();
    }

    [HttpPost("{id:int}/condition")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult> SetCondition(int id, LookupValue value)
    {
        var part = await _db.Parts.FindAsync(id);
        if (part is null) return NotFound();
        if (!string.IsNullOrEmpty(value.Name) && !await _db.Conditions.AnyAsync(c => c.Name == value.Name))
            return BadRequest(new { message = $"Unknown condition '{value.Name}'." });
        part.Condition = string.IsNullOrEmpty(value.Name) ? null : value.Name;
        await _db.SaveChangesAsync();
        return Ok();
    }

    private async Task<string?> ValidateLookups(Part part)
    {
        if (!await _db.PartTypes.AnyAsync(t => t.Type == part.Type))
            return $"Unknown part type '{part.Type}'.";
        if (part.Seller is not null && !await _db.Sellers.AnyAsync(s => s.Name == part.Seller))
            return $"Unknown seller '{part.Seller}'.";
        if (part.CpuSocket is not null && !await _db.CpuSockets.AnyAsync(s => s.Name == part.CpuSocket))
            return $"Unknown CPU socket '{part.CpuSocket}'.";
        if (part.PcieGen is not null && !await _db.PcieGens.AnyAsync(s => s.Name == part.PcieGen))
            return $"Unknown PCIe gen '{part.PcieGen}'.";
        if (part.RamType is not null && !await _db.RamTypes.AnyAsync(s => s.Name == part.RamType))
            return $"Unknown RAM type '{part.RamType}'.";
        if (part.Location is not null && !await _db.Locations.AnyAsync(s => s.Name == part.Location))
            return $"Unknown location '{part.Location}'.";
        if (part.Condition is not null && !await _db.Conditions.AnyAsync(s => s.Name == part.Condition))
            return $"Unknown condition '{part.Condition}'.";
        return null;
    }
}
