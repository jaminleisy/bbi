using BenBotInventory.Server.Data;
using BenBotInventory.Server.Models;
using BenBotInventory.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BenBotInventory.Server.Controllers;

public record LoginRequest(string UserId, string Password);
public record LoginResponse(string Token, string UserId, string Name, int PermissionLevel);
public record ChangePasswordRequest(string NewPassword);

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly TokenService _tokens;

    public AuthController(AppDbContext db, TokenService tokens)
    {
        _db = db;
        _tokens = tokens;
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest request)
    {
        var user = await _db.Users.FindAsync(request.UserId);
        if (user is null || string.IsNullOrEmpty(user.PasswordHash)
            || !PasswordHasher.Verify(request.Password, user.PasswordHash))
            return Unauthorized(new { message = "Invalid user ID or password." });

        var level = user.PermissionLevel is >= 1 and <= 3 ? user.PermissionLevel : 1;
        return new LoginResponse(_tokens.CreateToken(user), user.Id, user.Name, level);
    }

    [HttpPost("change-password")]
    [Authorize]
    public async Task<ActionResult> ChangePassword(ChangePasswordRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword))
            return BadRequest(new { message = "New password is required." });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = await _db.Users.FindAsync(userId);
        if (user is null) return Unauthorized();

        user.PasswordHash = PasswordHasher.Hash(request.NewPassword);
        await _db.SaveChangesAsync();
        return Ok();
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<object>> Me()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = await _db.Users.FindAsync(userId);
        if (user is null) return Unauthorized();
        var level = user.PermissionLevel is >= 1 and <= 3 ? user.PermissionLevel : 1;
        return new
        {
            userId = user.Id,
            name = user.Name,
            buildAccess = user.BuildAccess,
            permissionLevel = level
        };
    }
}
