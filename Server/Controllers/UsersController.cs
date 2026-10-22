using BenBotInventory.Server.Authorization;
using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BenBotInventory.Server.Controllers;

public record CreateUserRequest(string UserId, string Password, string Name, int PermissionLevel = 1, string? BuildAccess = null);
public record UpdateUserRequest(string Name, int PermissionLevel, string? BuildAccess);
public record AdminSetPasswordRequest(string NewPassword);

[ApiController]
[Route("api/users")]
[Authorize(Policy = PermissionPolicies.Level3)]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _db;

    public UsersController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> List()
    {
        var users = await _db.Users.AsNoTracking()
            .OrderBy(u => u.Name)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.PermissionLevel,
                u.BuildAccess
            })
            .ToListAsync();
        return Ok(users);
    }

    [HttpPost]
    public async Task<ActionResult> Create(CreateUserRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.UserId) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { message = "User ID and password are required." });
        if (request.PermissionLevel is < 1 or > 3)
            return BadRequest(new { message = "PermissionLevel must be 1, 2, or 3." });
        if (await _db.Users.AnyAsync(u => u.Id == request.UserId))
            return Conflict(new { message = "User ID already exists." });

        _db.Users.Add(new User
        {
            Id = request.UserId.Trim(),
            Name = string.IsNullOrWhiteSpace(request.Name) ? request.UserId.Trim() : request.Name.Trim(),
            PasswordHash = PasswordHasher.Hash(request.Password),
            PermissionLevel = request.PermissionLevel,
            BuildAccess = string.IsNullOrWhiteSpace(request.BuildAccess) ? null : request.BuildAccess.Trim()
        });
        await _db.SaveChangesAsync();
        return Ok();
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(string id, UpdateUserRequest request)
    {
        var user = await _db.Users.FindAsync(id);
        if (user is null) return NotFound();
        if (request.PermissionLevel is < 1 or > 3)
            return BadRequest(new { message = "PermissionLevel must be 1, 2, or 3." });
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { message = "Name is required." });

        user.Name = request.Name.Trim();
        user.PermissionLevel = request.PermissionLevel;
        user.BuildAccess = string.IsNullOrWhiteSpace(request.BuildAccess) ? null : request.BuildAccess.Trim();
        await _db.SaveChangesAsync();
        return Ok();
    }

    [HttpPost("{id}/password")]
    public async Task<ActionResult> SetPassword(string id, AdminSetPasswordRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword))
            return BadRequest(new { message = "New password is required." });

        var user = await _db.Users.FindAsync(id);
        if (user is null) return NotFound();

        user.PasswordHash = PasswordHasher.Hash(request.NewPassword);
        await _db.SaveChangesAsync();
        return Ok();
    }
}
