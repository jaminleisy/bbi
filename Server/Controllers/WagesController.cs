using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Controllers;

[ApiController]
[Route("api/wages")]
[Authorize(Policy = PermissionPolicies.Level3)]
public class WagesController : ControllerBase
{
    private readonly AppDbContext _db;

    public WagesController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetWages(
        [FromQuery] string? builder = null,
        [FromQuery] int? year = null)
    {
        var query = _db.Wages.AsQueryable();

        if (!string.IsNullOrWhiteSpace(builder))
            query = query.Where(w => w.BuilderUserId == builder);
        if (year is not null)
            query = query.Where(w => w.PaidDate != null && w.PaidDate.Value.Year == year);

        var users = await _db.Users.Select(u => new { u.Id, u.Name }).ToListAsync();
        var wages = await query
            .OrderByDescending(w => w.PaidDate)
            .ThenByDescending(w => w.Id)
            .ToListAsync();

        var nameMap = await ComputerDisplayName.MapAsync(
            _db, wages.Where(w => w.ComputerId != null).Select(w => w.ComputerId!.Value));

        return wages.Select(w => new
        {
            w.Id,
            w.BuilderUserId,
            BuilderName = users.FirstOrDefault(u => u.Id == w.BuilderUserId)?.Name,
            w.ComputerId,
            ComputerName = w.ComputerId != null && nameMap.TryGetValue(w.ComputerId.Value, out var n) ? n : null,
            w.Amount,
            w.PaidDate,
            w.PaidMethod,
            w.Notes
        }).ToList();
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Wage>> GetWage(int id)
    {
        var wage = await _db.Wages.FindAsync(id);
        if (wage is null) return NotFound();
        return wage;
    }

    [HttpPost]
    public async Task<ActionResult<Wage>> CreateWage(Wage wage)
    {
        wage.Id = 0;
        var error = await Validate(wage);
        if (error is not null) return BadRequest(new { message = error });

        _db.Wages.Add(wage);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetWage), new { id = wage.Id }, wage);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<Wage>> UpdateWage(int id, Wage wage)
    {
        var existing = await _db.Wages.FindAsync(id);
        if (existing is null) return NotFound();

        var error = await Validate(wage);
        if (error is not null) return BadRequest(new { message = error });

        existing.BuilderUserId = wage.BuilderUserId;
        existing.ComputerId = wage.ComputerId;
        existing.Amount = wage.Amount;
        existing.PaidDate = wage.PaidDate;
        existing.PaidMethod = wage.PaidMethod;
        existing.Notes = wage.Notes;

        await _db.SaveChangesAsync();
        return existing;
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> DeleteWage(int id)
    {
        var wage = await _db.Wages.FindAsync(id);
        if (wage is null) return NotFound();
        _db.Wages.Remove(wage);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<string?> Validate(Wage wage)
    {
        if (string.IsNullOrWhiteSpace(wage.BuilderUserId))
            return "BuilderUserId is required.";
        if (!await _db.Users.AnyAsync(u => u.Id == wage.BuilderUserId))
            return $"Unknown builder user '{wage.BuilderUserId}'.";
        if (wage.ComputerId is not null && !await _db.Computers.AnyAsync(c => c.Id == wage.ComputerId))
            return $"Unknown computer id '{wage.ComputerId}'.";
        return null;
    }
}
