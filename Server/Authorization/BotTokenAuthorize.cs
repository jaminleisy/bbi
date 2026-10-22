using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Primitives;

namespace BenBotInventory.Server.Authorization;

/// <summary>
/// Auth filter for endpoints called by the Chrome extension. Expects a
/// shared secret in the <c>X-Bot-Token</c> header, configured in
/// appsettings as <c>Messenger:BotToken</c>. Constant-time compared to
/// avoid timing side channels.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false)]
public sealed class BotTokenAuthorizeAttribute : Attribute, IAsyncAuthorizationFilter
{
    private const string HeaderName = "X-Bot-Token";
    private const string ConfigKey = "Messenger:BotToken";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var config = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var expected = config[ConfigKey];

        if (string.IsNullOrWhiteSpace(expected))
        {
            context.Result = new ObjectResult(new
            {
                message = $"Server missing '{ConfigKey}' configuration."
            })
            {
                StatusCode = StatusCodes.Status503ServiceUnavailable
            };
            return Task.CompletedTask;
        }

        if (!context.HttpContext.Request.Headers.TryGetValue(HeaderName, out StringValues provided)
            || provided.Count == 0
            || !ConstantTimeEquals(provided.ToString(), expected))
        {
            context.Result = new UnauthorizedResult();
        }

        return Task.CompletedTask;
    }

    private static bool ConstantTimeEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        var diff = 0;
        for (var i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }
}
