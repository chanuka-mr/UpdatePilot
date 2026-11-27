namespace UpdatePilot.Agent;

internal static class EndpointValidator
{
    internal static Uri? Validate(string? rawUrl, string? allowedHost, bool allowLocalhost)
    {
        if (string.IsNullOrWhiteSpace(rawUrl)) return null;
        if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out var endpoint)) return null;
        if (!string.IsNullOrEmpty(endpoint.UserInfo)) return null;

        if (endpoint.Scheme == Uri.UriSchemeHttps)
        {
            if (string.IsNullOrWhiteSpace(endpoint.Host)) return null;
            if (!string.IsNullOrWhiteSpace(allowedHost) &&
                !string.Equals(endpoint.Host, allowedHost.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
            return endpoint;
        }

        if (allowLocalhost && endpoint.Scheme == Uri.UriSchemeHttp &&
            (string.Equals(endpoint.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(endpoint.Host, "localhost", StringComparison.OrdinalIgnoreCase)))
        {
            return endpoint;
        }

        return null;
    }
}
