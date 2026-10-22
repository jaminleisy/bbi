using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;

namespace BenBotInventory.Server.Authorization;

public static class PermissionClaim
{
    public const string Type = "permission_level";
}

public static class PermissionPolicies
{
    public const string Level2 = "PermissionLevel2";
    public const string Level3 = "PermissionLevel3";

    public static void AddPermissionPolicies(this IServiceCollection services)
    {
        services.AddSingleton<IAuthorizationHandler, MinPermissionHandler>();
        services.AddAuthorization(options =>
        {
            options.AddPolicy(Level2, p => p.AddRequirements(new MinPermissionRequirement(2)));
            options.AddPolicy(Level3, p => p.AddRequirements(new MinPermissionRequirement(3)));
        });
    }
}

public class MinPermissionRequirement : IAuthorizationRequirement
{
    public int Level { get; }
    public MinPermissionRequirement(int level) => Level = level;
}

public class MinPermissionHandler : AuthorizationHandler<MinPermissionRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        MinPermissionRequirement requirement)
    {
        var raw = context.User.FindFirstValue(PermissionClaim.Type);
        if (int.TryParse(raw, out var level) && level >= requirement.Level)
            context.Succeed(requirement);
        return Task.CompletedTask;
    }
}

public static class ClaimsPrincipalExtensions
{
    public static int GetPermissionLevel(this ClaimsPrincipal user)
    {
        var raw = user.FindFirstValue(PermissionClaim.Type);
        return int.TryParse(raw, out var level) ? level : 0;
    }
}
