/**
 * @describe This module provides functions to generate a JWT token for GitHub App authentication
 * and to retrieve an installation access token using that JWT. 
 * 
 */
import axios from 'axios';
import jwt from 'jsonwebtoken';
import fs from 'fs';

const baseUrl = 'https://api.github.com'; // Default GitHub API base URL
/**
 * Generate a JWT for GitHub App authentication (fixed 9‑minute lifetime as per GitHub limits < 10 minutes).
 * @param {string} clientId - GitHub App Client ID
 * @param {string} privatePem - Private key content (PEM string or path to PEM file)
 * @returns {string} Signed JWT
 */
function generateJWT(clientId, privatePem) {
    const expirationMinutes = 9; // keep well under GitHub 10‑minute max
    if (!clientId) throw new Error('Client ID is required');
    if (!privatePem) throw new Error('Private key is required');
    if (expirationMinutes > 10) throw new Error('JWT expiration cannot exceed 10 minutes');

    let privateKey;
    try {
        privateKey = fs.existsSync(privatePem) ? fs.readFileSync(privatePem, 'utf8') : privatePem;
    } catch (error) {
        throw new Error(`Error reading private key: ${error.message}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = { iat: now, exp: now + (expirationMinutes * 60), iss: clientId };
    try {
        return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
    } catch (error) {
        throw new Error(`Error generating JWT: ${error.message}`);
    }
}

/**
 * Internal helper that actually calls the GitHub API to create an installation access token.
 * @param {Object} params
 * @param {string} params.jwtToken Signed JWT for the GitHub App
 * @param {string|number} params.installationId Installation ID
 * @param {Object} [params.data] Optional request body (repositories / permissions)
 * @returns {Promise<Object>} Raw response data from GitHub
 */
async function requestInstallationAccessToken({ jwtToken, installationId, data = {} }) {
    const maxAttempts = parseInt(process.env.TOKEN_REQUEST_RETRY_ATTEMPTS || '3', 10);
    const baseDelay = parseInt(process.env.TOKEN_REQUEST_RETRY_BASE_MS || '300', 10); // ms

    function isTransient(error) {
        if (!error) return false;
        if (error.response) {
            return [502, 503, 504].includes(error.response.status);
        }
        if (error.request && !error.response) return true; // network / timeout
        return false;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    let attempt = 0;
    while (attempt < maxAttempts) {
        attempt += 1;
        try {
            const response = await axios.post(
                `${baseUrl}/app/installations/${installationId}/access_tokens`,
                data,
                {
                    headers: {
                        Authorization: `Bearer ${jwtToken}`,
                        Accept: 'application/vnd.github+json',
                        'User-Agent': 'GitHub-App-Node-Client',
                        'X-GitHub-Api-Version': '2022-11-28'
                    },
                    validateStatus: s => (s >= 200 && s < 300) || [502,503,504].includes(s)
                }
            );
            if (response.status >= 200 && response.status < 300) {
                return response.data;
            }

            if (attempt < maxAttempts) {
                const delay = Math.round(baseDelay * Math.pow(2, attempt - 1) + Math.random() * baseDelay);
                console.warn(`[installation-token] transient status=${response.status} attempt=${attempt}/${maxAttempts} retrying in ${delay}ms`);
                await sleep(delay);
                continue;
            }
            break;
        } catch (error) {
            if (isTransient(error) && attempt < maxAttempts) {
                const delay = Math.round(baseDelay * Math.pow(2, attempt - 1) + Math.random() * baseDelay);
                const status = error.response ? error.response.status : 'NO_RESPONSE';
                console.warn(`[installation-token] transient error status=${status} attempt=${attempt}/${maxAttempts} retrying in ${delay}ms`);
                await sleep(delay);
                continue;
            }
            console.log(error);
            break;
        }
    }
}

function validateCoreParams({ clientId, privatePem, installationId }) {
    if (!clientId) throw new Error('Client ID is required');
    if (!privatePem) throw new Error('Private key is required');
    if (!installationId) throw new Error('Installation ID is required');
}

function buildAccessTokenRequestBody(repositories, permissions) {
    if (!repositories && !permissions) return undefined;
    const body = {};
    if (repositories) body.repositories = repositories;
    if (permissions) body.permissions = permissions;
    return body;
}

/**
 * Core function: obtains an installation access token. If repositories/permissions are omitted,
 * a token with full installation repository access is returned. Always returns the full GitHub response object.
 */
async function getAccessToken({ clientId, privatePem, installationId, repositories, permissions }) {
    console.log('getRepoAccessToken called with:', { clientId, installationId, repositories, permissions });
    try {
        validateCoreParams({ clientId, privatePem, installationId });
        const jwtToken = generateJWT(clientId, privatePem);
        const requestBody = buildAccessTokenRequestBody(repositories, permissions) || {};
        return await requestInstallationAccessToken({ jwtToken, installationId, data: requestBody });
    } catch (error) {
        console.log(error);
    }
}

export {
    getAccessToken
};