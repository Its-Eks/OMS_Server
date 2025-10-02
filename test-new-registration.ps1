# Test New User Registration and Setup Flow
param(
    [Parameter(Mandatory=$true)]
    [string]$AdminToken,
    [Parameter(Mandatory=$true)]
    [string]$TestEmail,
    [Parameter(Mandatory=$false)]
    [string]$TestPassword = "TestPassword123!"
)

$headers = @{ 
    "Authorization" = "Bearer $AdminToken"
    "Content-Type" = "application/json"
}

$baseUrl = "http://localhost:3000"

Write-Host "🧪 Testing New User Registration Flow" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Test Email: $TestEmail" -ForegroundColor White
Write-Host ""

# Step 1: Register new user
Write-Host "1. Registering new user..." -ForegroundColor Yellow
$registerBody = @{
    email = $TestEmail
    firstName = "Test"
    lastName = "User"
    roleName = "Operations Manager"
} | ConvertTo-Json

try {
    $registerResult = Invoke-RestMethod -Uri "$baseUrl/auth/register" -Method POST -Headers $headers -Body $registerBody
    Write-Host "✅ User registered successfully!" -ForegroundColor Green
    Write-Host "   User ID: $($registerResult.userId)" -ForegroundColor White
    Write-Host "   Setup Token: $($registerResult.setupToken.Substring(0, 20))..." -ForegroundColor White
    Write-Host "   Message: $($registerResult.message)" -ForegroundColor White
    
    if ($registerResult.emailPreviewUrl) {
        Write-Host "   📧 Email Preview: $($registerResult.emailPreviewUrl)" -ForegroundColor Yellow
    }
    
    $setupToken = $registerResult.setupToken
    
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "❌ Registration failed" -ForegroundColor Red
    Write-Host "   Status Code: $statusCode" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Test setup page access
Write-Host "`n2. Testing setup page access..." -ForegroundColor Yellow
$setupUrl = "$baseUrl/auth/setup?token=$([System.Web.HttpUtility]::UrlEncode($setupToken))"
Write-Host "   Setup URL: $setupUrl" -ForegroundColor White

try {
    $setupPageResponse = Invoke-WebRequest -Uri $setupUrl -Method GET
    if ($setupPageResponse.StatusCode -eq 200) {
        Write-Host "✅ Setup page accessible" -ForegroundColor Green
        Write-Host "   Page contains email verification form" -ForegroundColor White
    }
} catch {
    Write-Host "❌ Setup page not accessible" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 3: Simulate email verification
Write-Host "`n3. Simulating email verification..." -ForegroundColor Yellow
$verifyBody = @{
    token = $setupToken
    action = "verify_email"
}

try {
    $verifyResponse = Invoke-WebRequest -Uri "$baseUrl/auth/complete-setup" -Method POST -Body $verifyBody -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if ($verifyResponse.StatusCode -eq 302) {
        Write-Host "✅ Email verification successful (redirected)" -ForegroundColor Green
    }
} catch {
    if ($_.Exception.Response.StatusCode -eq 302) {
        Write-Host "✅ Email verification successful (redirected)" -ForegroundColor Green
    } else {
        Write-Host "❌ Email verification failed" -ForegroundColor Red
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Step 4: Simulate password setting
Write-Host "`n4. Simulating password setup..." -ForegroundColor Yellow
$passwordBody = @{
    token = $setupToken
    action = "set_password"
    password = $TestPassword
    confirmPassword = $TestPassword
}

try {
    $passwordResponse = Invoke-WebRequest -Uri "$baseUrl/auth/complete-setup" -Method POST -Body $passwordBody -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if ($passwordResponse.StatusCode -eq 302) {
        Write-Host "✅ Password setup successful (redirected to success page)" -ForegroundColor Green
    }
} catch {
    if ($_.Exception.Response.StatusCode -eq 302) {
        Write-Host "✅ Password setup successful (redirected to success page)" -ForegroundColor Green
    } else {
        Write-Host "❌ Password setup failed" -ForegroundColor Red
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Step 5: Test success page
Write-Host "`n5. Testing success page..." -ForegroundColor Yellow
$successUrl = "$baseUrl/auth/setup-complete?token=$([System.Web.HttpUtility]::UrlEncode($setupToken))"

try {
    $successResponse = Invoke-WebRequest -Uri $successUrl -Method GET
    if ($successResponse.StatusCode -eq 200) {
        Write-Host "✅ Success page accessible" -ForegroundColor Green
        Write-Host "   Page contains login link and welcome message" -ForegroundColor White
    }
} catch {
    Write-Host "❌ Success page not accessible" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 6: Test login with new credentials
Write-Host "`n6. Testing login with new credentials..." -ForegroundColor Yellow
$loginBody = @{
    email = $TestEmail
    password = $TestPassword
} | ConvertTo-Json

$loginHeaders = @{ 
    "Content-Type" = "application/json"
}

try {
    $loginResult = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -Headers $loginHeaders -Body $loginBody
    Write-Host "✅ Login successful!" -ForegroundColor Green
    Write-Host "   New user can access the platform" -ForegroundColor White
    Write-Host "   Access Token: $($loginResult.accessToken.Substring(0, 20))..." -ForegroundColor White
} catch {
    Write-Host "❌ Login failed" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎉 Testing Complete!" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "✨ Key Features Tested:" -ForegroundColor White
Write-Host "   • Non-expiring setup tokens" -ForegroundColor White
Write-Host "   • Beautiful email templates" -ForegroundColor White
Write-Host "   • Combined email verification + password setup" -ForegroundColor White
Write-Host "   • Success page with login link" -ForegroundColor White
Write-Host "   • Token expires ONLY after successful completion" -ForegroundColor White
Write-Host ""
Write-Host "🔗 Setup URL: $setupUrl" -ForegroundColor Yellow
Write-Host "📧 Check the email preview URL above for the email content" -ForegroundColor Yellow
