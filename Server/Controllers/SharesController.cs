using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Controllers;

[ApiController]
[Route("api/shares")]
[Authorize(Policy = PermissionPolicies.Level3)]
public class SharesController : ControllerBase
{
    private readonly AppDbContext _db;

    public SharesController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetShares([FromQuery] int? computerId = null)
    {
        var query = _db.ComputerShares.AsNoTracking().AsQueryable();
        if (computerId is not null)
            query = query.Where(s => s.ComputerId == computerId);

        var users = await _db.Users.AsNoTracking().Select(u => new { u.Id, u.Name }).ToListAsync();
        var shares = await query
            .OrderBy(s => s.Id)
            .ToListAsync();

        return shares.Select(s => new
        {
            s.Id,
            s.ComputerId,
            s.BuilderUserId,
            BuilderName = users.FirstOrDefault(u => u.Id == s.BuilderUserId)?.Name,
            s.Percentage
        }).ToList();
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ComputerShare>> GetShare(int id)
    {
        var share = await _db.ComputerShares.FindAsync(id);
        if (share is null) return NotFound();
        return share;
    }

    [HttpPost]
    public async Task<ActionResult<ComputerShare>> CreateShare(ComputerShare share)
    {
        share.Id = 0;
        var error = await Validate(share);
        if (error is not null) return BadRequest(new { message = error });

        _db.ComputerShares.Add(share);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetShare), new { id = share.Id }, share);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<ComputerShare>> UpdateShare(int id, ComputerShare share)
    {
        var existing = await _db.ComputerShares.FindAsync(id);
        if (existing is null) return NotFound();

        var error = await Validate(share);
        if (error is not null) return BadRequest(new { message = error });

        existing.ComputerId = share.ComputerId;
        existing.BuilderUserId = share.BuilderUserId;
        existing.Percentage = share.Percentage;

        await _db.SaveChangesAsync();
        return existing;
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> DeleteShare(int id)
    {
        var share = await _db.ComputerShares.FindAsync(id);
        if (share is null) return NotFound();
        _db.ComputerShares.Remove(share);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<string?> Validate(ComputerShare share)
    {
        if (share.ComputerId <= 0 || !await _db.Computers.AnyAsync(c => c.Id == share.ComputerId))
            return $"Unknown computer id '{share.ComputerId}'.";
        if (string.IsNullOrWhiteSpace(share.BuilderUserId))
            return "BuilderUserId is required.";
        if (!await _db.Users.AnyAsync(u => u.Id == share.BuilderUserId))
            return $"Unknown builder user '{share.BuilderUserId}'.";
        if (share.Percentage <= 0 || share.Percentage > 100)
            return "Percentage must be greater than 0 and at most 100.";
        return null;
    }
}
