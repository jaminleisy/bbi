using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BenBotInventory.Server.Controllers;

public record AddBuildNoteRequest(string Text);
public record SetBuildComputerNotesRequest(string? Notes);
public record SetBuildStatusRequest(string Status);
public record SetBuildBuilderRequest(string? BuilderUserId);

/// <summary>
/// Lower-permission builds API. Visibility is scoped by the caller's
/// Users.BuildAccess list (comma-separated builder names/ids matched against
/// Computer.BuilderUserId, "Unassigned" for builds with no builder, or "All"
/// for every PC build). Responses never include pricing.
/// </summary>
[ApiController]
[Authorize]
[Route("api/builds")]
public class BuildsController : ControllerBase
{
    private static readonly string[] BuildStatuses =
        { "Planned", "In-progress", "Built", "Active", "Sold", "Returned", "Needs repair", "Traded", "Personal" };

    private static readonly HashSet<string> StatusesThatConfirmParts =
        new(StringComparer.OrdinalIgnoreCase) { "Built", "Active", "Sold" };

    private readonly AppDbContext _db;
    private readonly PartSlotService _slots;

    public BuildsController(AppDbContext db, PartSlotService slots)
    {
        _db = db;
        _slots = slots;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> List()
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (access.Count == 0) return Ok(Array.Empty<object>());

        var computers = await AccessibleBuildsQuery(access)
            .OrderBy(c =>
                c.Status == "Planned" ? 0 :
                c.Status == "In-progress" ? 1 :
                c.Status == "Built" ? 2 :
                c.Status == "Active" ? 3 :
                c.Status == "Sold" ? 4 : 99)
            .ThenByDescending(c => c.AddedDate)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Status,
                c.BuilderUserId,
                c.Location,
                computerNotes = c.Notes,
                parts = c.Parts
                    .Select(p => new
                    {
                        p.Id,
                        p.Type,
                        p.Manufacturer,
                        p.ModelNumber,
                        p.Color,
                        p.Location,
                        p.Received
                    })
                    .ToList(),
                placeholders = c.Placeholders
                    .Select(p => new
                    {
                        p.Id,
                        p.Type,
                        p.Description
                    })
                    .ToList(),
                comments = c.BuildNotes
                    .OrderByDescending(n => n.CreatedDate)
                    .Select(n => new
                    {
                        n.Id,
                        n.UserId,
                        n.Text,
                        n.CreatedDate
                    })
                    .ToList()
            })
            .ToListAsync();

        var builderIds = computers
            .Select(c => c.BuilderUserId)
            .Where(id => id != null)
            .Distinct()
            .Cast<string>()
            .ToList();
        var commentUserIds = computers
            .SelectMany(c => c.comments.Select(n => n.UserId))
            .Distinct()
            .ToList();
        var nameIds = builderIds.Concat(commentUserIds).Distinct().ToList();
        var names = nameIds.Count == 0
            ? new Dictionary<string, string>()
            : await _db.Users.AsNoTracking()
                .Where(u => nameIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, u => u.Name);

        return Ok(computers.Select(c =>
        {
            string? builderName = null;
            if (c.BuilderUserId != null && names.TryGetValue(c.BuilderUserId, out var name))
                builderName = name;
            return new
            {
                c.Id,
                c.Name,
                c.Status,
                c.BuilderUserId,
                builderName = builderName ?? c.BuilderUserId,
                c.Location,
                computerNotes = c.computerNotes,
                parts = c.parts.OrderByPartType(p => p.Type).ToList(),
                placeholders = c.placeholders.OrderByPartType(p => p.Type).ToList(),
                comments = c.comments.Select(n => new
                {
                    n.Id,
                    n.UserId,
                    userName = names.TryGetValue(n.UserId, out var un) ? un : n.UserId,
                    n.Text,
                    n.CreatedDate
                }).ToList()
            };
        }));
    }

    /// <summary>Part types for placeholder pickers (Level 2+ — part editing).</summary>
    [HttpGet("part-types")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult<IEnumerable<object>>> GetPartTypes()
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();

        var types = (await _db.PartTypes.AsNoTracking()
                .Select(t => new { t.Type, t.Required })
                .ToListAsync())
            .OrderByPartType(t => t.Type)
            .ToList();
        return Ok(types);
    }

    /// <summary>Unassigned inventory parts of a type (no cost) for replace pickers.</summary>
    [HttpGet("unassigned-parts")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult<IEnumerable<object>>> GetUnassignedParts([FromQuery] string? type = null)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();

        // Never offer possibly/confirmed bad or scam parts for build assignment.
        var query = _db.Parts.AsNoTracking()
            .Where(p => p.ComputerId == null
                && (p.Bad == null || p.Bad == 0)
                && (p.Scam == null || p.Scam == 0));
        if (!string.IsNullOrWhiteSpace(type))
            query = query.Where(p => p.Type == type);

        var parts = await query
            .OrderBy(p => p.Manufacturer).ThenBy(p => p.ModelNumber)
            .Select(p => new
            {
                p.Id,
                p.Type,
                p.Manufacturer,
                p.ModelNumber,
                p.Color,
                p.Received,
                p.Condition,
                p.TestedDate,
                p.Location,
                p.OrderUrl
            })
            .ToListAsync();
        return Ok(parts);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<object>> Get(int id)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();

        var computer = await AccessibleBuildsQuery(access)
            .Where(c => c.Id == id)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Status,
                c.BuilderUserId,
                c.Location,
                c.Notes,
                parts = c.Parts
                    .Select(p => new
                    {
                        p.Id,
                        p.Type,
                        p.Manufacturer,
                        p.ModelNumber,
                        p.Color,
                        p.Location,
                        p.Received
                    })
                    .ToList(),
                placeholders = c.Placeholders
                    .Select(p => new
                    {
                        p.Id,
                        p.Type,
                        p.Description
                    })
                    .ToList(),
                comments = c.BuildNotes
                    .OrderByDescending(n => n.CreatedDate)
                    .Select(n => new
                    {
                        n.Id,
                        n.ComputerId,
                        n.UserId,
                        n.Text,
                        n.CreatedDate
                    })
                    .ToList()
            })
            .FirstOrDefaultAsync();

        if (computer is null) return NotFound();

        var userIds = computer.comments.Select(n => n.UserId).Distinct().ToList();
        var names = userIds.Count == 0
            ? new Dictionary<string, string>()
            : await _db.Users.AsNoTracking()
                .Where(u => userIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, u => u.Name);

        string? builderName = null;
        if (computer.BuilderUserId != null)
        {
            builderName = await _db.Users.AsNoTracking()
                .Where(u => u.Id == computer.BuilderUserId)
                .Select(u => u.Name)
                .FirstOrDefaultAsync()
                ?? computer.BuilderUserId;
        }

        return Ok(new
        {
            computer.Id,
            computer.Name,
            computer.Status,
            computer.BuilderUserId,
            BuilderName = builderName,
            computer.Location,
            computerNotes = computer.Notes,
            parts = computer.parts.OrderByPartType(p => p.Type).ToList(),
            placeholders = computer.placeholders.OrderByPartType(p => p.Type).ToList(),
            // Keep "notes" key for BuildNotes (UI "Comments") for client compatibility.
            notes = computer.comments.Select(n => new
            {
                n.Id,
                n.ComputerId,
                n.UserId,
                userName = names.TryGetValue(n.UserId, out var name) ? name : n.UserId,
                n.Text,
                n.CreatedDate
            }).ToList()
        });
    }

    [HttpPost("{id:int}/notes")]
    public async Task<ActionResult<object>> AddNote(int id, AddBuildNoteRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();

        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();

        if (string.IsNullOrWhiteSpace(request.Text))
            return BadRequest(new { message = "Note text is required." });

        if (!await CanAccessAsync(access, id)) return NotFound();

        var note = new BuildNote
        {
            ComputerId = id,
            UserId = userId,
            Text = request.Text.Trim(),
            CreatedDate = DateTime.UtcNow
        };
        _db.BuildNotes.Add(note);
        await _db.SaveChangesAsync();

        var user = await _db.Users.FindAsync(userId);
        return Ok(new
        {
            note.Id,
            note.ComputerId,
            note.UserId,
            userName = user?.Name ?? userId,
            note.Text,
            note.CreatedDate
        });
    }

    /// <summary>Update Computer.Notes (Level 2+).</summary>
    [HttpPut("{id:int}/computer-notes")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult> SetComputerNotes(int id, SetBuildComputerNotesRequest request)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (!await CanAccessAsync(access, id)) return NotFound();

        var computer = await _db.Computers.FirstOrDefaultAsync(c => c.Id == id);
        if (computer is null) return NotFound();

        var notes = request.Notes?.Trim();
        if (notes is { Length: > 4000 })
            return BadRequest(new { message = "Notes must be at most 4000 characters." });

        computer.Notes = string.IsNullOrEmpty(notes) ? null : notes;
        await _db.SaveChangesAsync();
        return Ok(new { computerNotes = computer.Notes });
    }

    [HttpPost("{id:int}/status")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult> SetStatus(int id, SetBuildStatusRequest request)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (!await CanAccessAsync(access, id)) return NotFound();

        var status = request.Status?.Trim() ?? "";
        if (!BuildStatuses.Contains(status))
            return BadRequest(new { message = $"Status must be one of: {string.Join(", ", BuildStatuses)}." });

        var computer = await _db.Computers.FirstOrDefaultAsync(c => c.Id == id);
        if (computer is null) return NotFound();

        computer.Status = status;
        if (status == "Sold")
            computer.SoldDate ??= DateTime.UtcNow;
        if (StatusesThatConfirmParts.Contains(status))
            await MarkAssignedPartsReceivedAndTestedAsync(id);

        await _db.SaveChangesAsync();
        return Ok(new { computer.Status, computer.SoldDate });
    }

    [HttpPost("{id:int}/builder")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult> SetBuilder(int id, SetBuildBuilderRequest request)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (!await CanAccessAsync(access, id)) return NotFound();

        var computer = await _db.Computers.FirstOrDefaultAsync(c => c.Id == id);
        if (computer is null) return NotFound();

        string? builderId = string.IsNullOrWhiteSpace(request.BuilderUserId) ? null : request.BuilderUserId.Trim();
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

    [HttpPost("{id:int}/placeholders")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult<object>> AddPlaceholder(int id, PlaceholderRequest request)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (!await CanAccessAsync(access, id)) return NotFound();

        var (ph, error) = await _slots.AddPlaceholderAsync(id, request);
        if (error is not null) return BadRequest(new { message = error });
        return Ok(PartSlotService.ToDto(ph!));
    }

    [HttpPut("{id:int}/placeholders/{phId:int}")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult<object>> UpdatePlaceholder(int id, int phId, PlaceholderRequest request)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (!await CanAccessAsync(access, id)) return NotFound();

        var (ph, error) = await _slots.UpdatePlaceholderAsync(id, phId, request);
        if (error == "notfound") return NotFound();
        if (error is not null) return BadRequest(new { message = error });
        return Ok(PartSlotService.ToDto(ph!));
    }

    [HttpDelete("{id:int}/placeholders/{phId:int}")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult> DeletePlaceholder(int id, int phId)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (!await CanAccessAsync(access, id)) return NotFound();

        var error = await _slots.DeletePlaceholderAsync(id, phId);
        if (error == "notfound") return NotFound();
        return NoContent();
    }

    [HttpPost("{id:int}/placeholders/{phId:int}/replace")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult> ReplacePlaceholder(int id, int phId, ReplaceWithPartRequest request)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (!await CanAccessAsync(access, id)) return NotFound();

        var error = await _slots.ReplacePlaceholderWithPartAsync(id, phId, request.PartId);
        if (error == "notfound") return NotFound();
        if (error is not null) return BadRequest(new { message = error });
        return Ok();
    }

    [HttpPost("{id:int}/parts/{partId:int}/replace-with-placeholder")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult<object>> ReplacePartWithPlaceholder(
        int id, int partId, ReplaceWithPlaceholderRequest request)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (!await CanAccessAsync(access, id)) return NotFound();

        var (ph, error) = await _slots.ReplacePartWithPlaceholderAsync(id, partId, request.Description);
        if (error == "notfound") return NotFound();
        if (error is not null) return BadRequest(new { message = error });
        return Ok(PartSlotService.ToDto(ph!));
    }

    [HttpPost("{id:int}/parts/{partId:int}/replace-with-part")]
    [Authorize(Policy = PermissionPolicies.Level2)]
    public async Task<ActionResult> ReplacePartWithPart(int id, int partId, ReplacePartWithPartRequest request)
    {
        var access = await GetCallerBuildAccessAsync();
        if (access is null) return Unauthorized();
        if (!await CanAccessAsync(access, id)) return NotFound();

        var error = await _slots.ReplacePartWithPartAsync(id, partId, request.NewPartId);
        if (error == "notfound") return NotFound();
        if (error is not null) return BadRequest(new { message = error });
        return Ok();
    }

    private async Task<bool> CanAccessAsync(HashSet<string> access, int id) =>
        await AccessibleBuildsQuery(access).AnyAsync(c => c.Id == id);

    private async Task<HashSet<string>?> GetCallerBuildAccessAsync()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return null;
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null) return null;
        return ParseBuildAccess(user.BuildAccess);
    }

    private IQueryable<Computer> AccessibleBuildsQuery(HashSet<string> access)
    {
        // Only active pipeline statuses, plus recently sold (last 60 days).
        var soldSince = DateTime.UtcNow.Date.AddDays(-60);
        var pcs = _db.Computers.AsNoTracking()
            .Where(c => c.Type == "PC")
            .Where(c =>
                c.Status == "Planned" ||
                c.Status == "In-progress" ||
                c.Status == "Built" ||
                c.Status == "Active" ||
                (c.Status == "Sold" && c.SoldDate != null && c.SoldDate >= soldSince));

        if (access.Contains("All"))
            return pcs;

        var includeUnassigned = access.Contains("Unassigned");
        var accessList = access
            .Where(a => !a.Equals("Unassigned", StringComparison.OrdinalIgnoreCase)
                        && !a.Equals("All", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var allowedBuilderIds = accessList.Count == 0
            ? new List<string>()
            : _db.Users.AsNoTracking()
                .Where(u => accessList.Contains(u.Id) || accessList.Contains(u.Name))
                .Select(u => u.Id)
                .ToList();
        foreach (var token in accessList)
        {
            if (!allowedBuilderIds.Contains(token))
                allowedBuilderIds.Add(token);
        }

        return pcs.Where(c =>
            (includeUnassigned && c.BuilderUserId == null) ||
            (c.BuilderUserId != null && allowedBuilderIds.Contains(c.BuilderUserId)));
    }

    private static HashSet<string> ParseBuildAccess(string? buildAccess) =>
        (buildAccess ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

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
}
