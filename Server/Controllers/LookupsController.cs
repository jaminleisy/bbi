using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Controllers;

public record LookupValue(string Name);

[ApiController]
[Route("api/lookups")]
[Authorize(Policy = PermissionPolicies.Level2)]
public class LookupsController : ControllerBase
{
    private readonly AppDbContext _db;

    public LookupsController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<object>> GetAll()
    {
        var types = (await _db.PartTypes.AsNoTracking().ToListAsync())
            .OrderByPartType(t => t.Type)
            .ToList();
        return new
        {
            types,
            sellers = await _db.Sellers.OrderBy(s => s.Name).Select(s => s.Name).ToListAsync(),
            cpuSockets = await _db.CpuSockets.OrderBy(s => s.Name).Select(s => s.Name).ToListAsync(),
            pcieGens = await _db.PcieGens.OrderBy(s => s.Name).Select(s => s.Name).ToListAsync(),
            ramTypes = await _db.RamTypes.OrderBy(s => s.Name).Select(s => s.Name).ToListAsync(),
            locations = await _db.Locations.OrderBy(s => s.Name).Select(s => s.Name).ToListAsync(),
            conditions = await _db.Conditions.OrderBy(s => s.Name).Select(s => s.Name).ToListAsync(),
            users = await _db.Users.OrderBy(u => u.Name).Select(u => new { u.Id, u.Name }).ToListAsync()
        };
    }

    [HttpPost("sellers")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult> AddSeller(LookupValue value)
    {
        if (!await _db.Sellers.AnyAsync(s => s.Name == value.Name))
        {
            _db.Sellers.Add(new Seller { Name = value.Name });
            await _db.SaveChangesAsync();
        }
        return Ok();
    }

    [HttpPost("cpu-sockets")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult> AddCpuSocket(LookupValue value)
    {
        if (!await _db.CpuSockets.AnyAsync(s => s.Name == value.Name))
        {
            _db.CpuSockets.Add(new CpuSocket { Name = value.Name });
            await _db.SaveChangesAsync();
        }
        return Ok();
    }

    [HttpPost("pcie-gens")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult> AddPcieGen(LookupValue value)
    {
        if (!await _db.PcieGens.AnyAsync(s => s.Name == value.Name))
        {
            _db.PcieGens.Add(new PcieGen { Name = value.Name });
            await _db.SaveChangesAsync();
        }
        return Ok();
    }

    [HttpPost("ram-types")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult> AddRamType(LookupValue value)
    {
        if (!await _db.RamTypes.AnyAsync(s => s.Name == value.Name))
        {
            _db.RamTypes.Add(new RamType { Name = value.Name });
            await _db.SaveChangesAsync();
        }
        return Ok();
    }

    [HttpPost("locations")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult> AddLocation(LookupValue value)
    {
        if (!await _db.Locations.AnyAsync(s => s.Name == value.Name))
        {
            _db.Locations.Add(new Location { Name = value.Name });
            await _db.SaveChangesAsync();
        }
        return Ok();
    }

    [HttpPost("conditions")]
    [Authorize(Policy = PermissionPolicies.Level3)]
    public async Task<ActionResult> AddCondition(LookupValue value)
    {
        if (!await _db.Conditions.AnyAsync(s => s.Name == value.Name))
        {
            _db.Conditions.Add(new Condition { Name = value.Name });
            await _db.SaveChangesAsync();
        }
        return Ok();
    }
}
