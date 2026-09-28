/**
 * Fetches an access token from the mock OIDC server in compose.yml.
 *
 * Which claims a client id receives is configured in dev/oidc/config.json.
 */
export const fetchAccessToken = async (clientId: string): Promise<string> => {
    const response = await fetch("http://localhost:12003/default/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: "test",
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch access token, got status ${response.status}`);
    }

    const body = (await response.json()) as { access_token: string };
    return body.access_token;
};
