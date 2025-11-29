# OIDC Authentication - How It Works

## Overview

This application uses Kong API Gateway's OIDC plugin for authentication with BC Government's CSS (Common Single Sign-On) service. The authentication flow supports both **IDIR** (government employees) and **BCSC** (BC Services Card) authentication methods.

## Architecture

```
User → Kong Gateway → OIDC Plugin → BC CSS SSO → Kong → Middleware → MongoDB
```

### Components:

1. **Kong API Gateway** (`gateway/midware.yaml`)
   - Intercepts authentication requests
   - Handles OAuth2/OIDC flow with BC CSS SSO
   - Injects user information headers into requests

2. **Social Middleware** (NestJS application)
   - Processes authenticated user data
   - Creates/updates user records in MongoDB
   - Manages session cookies

3. **BC CSS SSO** (test.loginproxy.gov.bc.ca)
   - BC Government's authentication service
   - Supports IDIR and BCSC login methods

## Authentication Flow

### Step-by-Step Process:

1. **User visits `/auth/login`**
   - Kong OIDC plugin detects unauthenticated request
   - Redirects to BC CSS SSO login page

2. **User authenticates with IDIR or BCSC**
   - User selects authentication method (IDIR/BCSC)
   - Completes login at BC CSS SSO

3. **OAuth callback**
   - BC CSS redirects to Kong with authorization code
   - Kong exchanges code for access/ID tokens
   - Kong validates tokens

4. **Kong injects headers**
   - `x-userinfo`: Base64-encoded user information
   - `x-access-token`: JWT access token
   - `x-id-token`: JWT ID token
   - `x-credential-identifier`: User identifier

5. **Middleware processes request**
   - Decodes `x-userinfo` header
   - Extracts user data (name, email, etc.)
   - Creates or updates user in MongoDB
   - Generates session JWT token
   - Sets secure HTTP-only session cookie

6. **Redirect to dashboard**
   - User redirected to frontend dashboard
   - Session cookie enables authenticated requests

## User Data Fields

### IDIR Authentication Provides:
- ✅ `given_name` (first name)
- ✅ `family_name` (last name)
- ✅ `email`
- ✅ `sub` (unique identifier)
- ✅ `idir_username`
- ✅ `idir_user_guid`

### BCSC Authentication Additionally Provides:
- ✅ `birthdate`
- ✅ `gender`
- ✅ `address` (street, city, region, postal code, country)

**Note:** The application handles both authentication types by making BCSC-specific fields optional.

## Testing the Authentication Flow

### 1. Test Login (Happy Path)

**Steps:**
1. Navigate to: `https://social-middleware.test.api.gov.bc.ca/auth/login`
2. You'll be redirected to BC CSS SSO login page
3. Select authentication method:
   - **IDIR**: Use government employee credentials
   - **BCSC**: Use BC Services Card
4. Complete authentication
5. After successful login, you'll be redirected to:
   ```
   https://caregiver.test.api.gov.bc.ca/dashboard
   ```

**Expected Logs:**
```
INFO: ========== /auth/login reached ==========
INFO: Kong OIDC authenticated user successfully, processing...
INFO: OIDC user information decoded
INFO: Finding or creating user...
INFO: User persisted (userId: <mongodb-id>)
INFO: Session cookie set — redirecting to dashboard...
```

### 2. Test Authentication Status

**Check if authenticated:**
```bash
curl -X GET https://social-middleware.test.api.gov.bc.ca/auth/status \
  --cookie "session=<your-session-cookie>" \
  -H "Content-Type: application/json"
```

**Expected Response (authenticated):**
```json
{
  "user": {
    "id": "19f7fcd5bb3a46ea973f68f9a38ee3f5@azureidir",
    "email": "user@gov.bc.ca",
    "name": "Lastname, Firstname"
  }
}
```

**Expected Response (not authenticated):**
```json
{
  "error": "Not authenticated"
}
```
HTTP Status: 401

### 3. Test Logout

**Steps:**
1. Navigate to: `https://social-middleware.test.api.gov.bc.ca/auth/logout`
2. Session cookie will be cleared
3. You'll be redirected to:
   ```
   https://caregiver.test.api.gov.bc.ca/login
   ```

### 4. Verify User in Database

**Connect to MongoDB and check:**
```bash
# Access MongoDB pod
kubectl exec -it <mongodb-pod> -n <namespace> -- mongosh

# Query users collection
use social-middleware
db.users.find({ email: "your-email@gov.bc.ca" }).pretty()
```

**Expected Document:**
```json
{
  "_id": ObjectId("..."),
  "bc_services_card_id": "19f7fcd5bb3a46ea973f68f9a38ee3f5@azureidir",
  "first_name": "Christopher",
  "last_name": "Dodd",
  "email": "christopher.dodd@gov.bc.ca",
  "dateOfBirth": "",  // Empty for IDIR users
  "sex": "",          // Empty for IDIR users
  "street_address": "", // Empty for IDIR users
  "city": "",
  "region": "",
  "postal_code": "",
  "status": "ACTIVE",
  "last_login": ISODate("..."),
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("...")
}
```

## Configuration

### Kong Gateway (`gateway/midware.yaml`)

**OIDC Plugin Configuration:**
```yaml
- name: oidc
  config:
    client_id: caregiver-registry-6059
    client_secret: <vault://...>
    discovery: https://test.loginproxy.gov.bc.ca/auth/realms/standard/.well-known/openid-configuration
    redirect_uri: https://social-middleware.test.api.gov.bc.ca/auth/callback
    scope: openid profile email
    session_secret: <vault://...>
    introspection_endpoint: https://test.loginproxy.gov.bc.ca/auth/realms/standard/protocol/openid-connect/token/introspect
    userinfo_header_name: X-Userinfo
    id_token_header_name: X-Id-Token
    access_token_header_name: X-Access-Token
    unauth_action: auth  # Redirect to login if not authenticated
    response_type: code
    ssl_verify: true
    token_endpoint_auth_method: client_secret_basic
```

### Environment Variables (Middleware)

Required in `.env`:
```
JWT_SECRET=<your-jwt-secret>
FRONTEND_URL=https://caregiver.test.api.gov.bc.ca
NODE_ENV=production
```

## Troubleshooting

### Issue: Redirected to error page

**Check logs for:**
```
ERROR: Missing X-Userinfo from Kong OIDC
```
**Solution:** Verify Kong OIDC plugin is enabled and configured correctly.

---

**Check logs for:**
```
ERROR: Error during OIDC callback processing
```
**Solution:** Check MongoDB connection and user schema validation.

### Issue: Session cookie not set

**Symptoms:** Can't access authenticated endpoints after login

**Check:**
1. Cookie settings in `auth.controller.ts` (lines 161-168)
2. Ensure `FRONTEND_URL` starts with `https://` for secure cookies
3. Verify `sameSite: 'lax'` allows cross-site redirects

### Issue: User validation errors

**Check logs for:**
```
ERROR: User validation failed: <field>: Path `<field>` is required
```
**Solution:** Ensure all required fields in `user.schema.ts` are marked `required: false` or have defaults.

### Debug Tips

**Enable detailed logging:**
```typescript
// In auth.controller.ts
this.logger.info({ headers: req.headers }, 'Headers from Kong');
this.logger.info({ userInfo }, 'OIDC user information decoded');
```

**Check Kong logs:**
```bash
kubectl logs -f <kong-pod> -n <namespace>
```

**Check middleware logs:**
```bash
kubectl logs -f <middleware-pod> -n <namespace>
```

## Security Considerations

1. **Session Cookies:**
   - `httpOnly: true` - Prevents JavaScript access
   - `secure: true` - HTTPS only (production)
   - `sameSite: 'lax'` - CSRF protection
   - 24-hour expiry

2. **JWT Tokens:**
   - Signed with `JWT_SECRET`
   - Contains user ID and email
   - 24-hour expiry

3. **Kong OIDC:**
   - Validates tokens with BC CSS SSO
   - SSL verification enabled
   - Session secret for encryption

## Additional Resources

- Kong OIDC Plugin: https://docs.konghq.com/hub/nokia/oidc/
- BC CSS Documentation: https://github.com/bcgov/sso-keycloak
- OAuth 2.0 Authorization Code Flow: https://oauth.net/2/grant-types/authorization-code/
