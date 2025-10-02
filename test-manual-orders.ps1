# Manual Orders Testing Script
param(
    [Parameter(Mandatory=$true)]
    [string]$Token
)

$headers = @{ 
    "Authorization" = "Bearer $Token"
    "Content-Type" = "application/json"
}

$baseUrl = "http://localhost:3000/orders-templates"

Write-Host "📧 Testing Manual Order Emails" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan

# Test 1: New Installation Scheduled
Write-Host "`n1. Testing New Installation - Scheduled..." -ForegroundColor Yellow
$body1 = @{
    orderId = "test-uuid-001"
    orderType = "new_installation"
    status = "scheduled"
    customerEmail = "xnxiweni@xnext.co.za"
    templateData = @{
        customerName = "Jesse Mashoana"
        orderNumber = "ORD-TEST-123"
        serviceType = "Fiber 100Mbps"
        address = "123 Main St, Johannesburg"
        installationDate = "October 15, 2025"
        appointmentTime = "9:00 AM - 12:00 PM"
        technicianName = "Mike Johnson"
        estimatedDuration = "2-3 hours"
        contactNumber = "+27 11 123 4567"
    }
} | ConvertTo-Json -Depth 3

try {
    $result1 = Invoke-RestMethod -Uri "$baseUrl/trigger" -Method POST -Headers $headers -Body $body1
    Write-Host "✅ New Installation Scheduled email sent!" -ForegroundColor Green
    Write-Host "   Template used: $($result1.data.templateUsed)" -ForegroundColor White
} catch {
    Write-Host "❌ Failed to send New Installation Scheduled email" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: New Installation Completed
Write-Host "`n2. Testing New Installation - Completed..." -ForegroundColor Yellow
$body2 = @{
    orderId = "test-uuid-001"
    orderType = "new_installation"
    status = "completed"
    customerEmail = "xnxiweni@xnext.co.za"
    templateData = @{
        customerName = "Jesse Mashoana"
        orderNumber = "ORD-TEST-123"
        serviceType = "Fiber 100Mbps"
        address = "123 Main St, Johannesburg"
        activationDate = "October 15, 2025"
        wifiNetwork = "Jesse_Fiber"
        downloadSpeed = "100 Mbps"
        uploadSpeed = "100 Mbps"
        supportNumber = "+27 11 123 4567"
        customerPortalUrl = "https://portal.example.com"
        mobileAppName = "MyISP App"
        billingNumber = "+27 11 123 4568"
    }
} | ConvertTo-Json -Depth 3

try {
    $result2 = Invoke-RestMethod -Uri "$baseUrl/trigger" -Method POST -Headers $headers -Body $body2
    Write-Host "✅ New Installation Completed email sent!" -ForegroundColor Green
    Write-Host "   Template used: $($result2.data.templateUsed)" -ForegroundColor White
} catch {
    Write-Host "❌ Failed to send New Installation Completed email" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Service Change Scheduled
Write-Host "`n3. Testing Service Change - Scheduled..." -ForegroundColor Yellow
$body3 = @{
    orderId = "test-uuid-002"
    orderType = "service_change"
    status = "scheduled"
    customerEmail = "xnxiweni@xnext.co.za"
    templateData = @{
        customerName = "Jesse Mashoana"
        orderNumber = "ORD-TEST-456"
        currentService = "Fiber 50Mbps"
        serviceType = "Fiber 200Mbps"
        changeDate = "October 20, 2025"
        appointmentTime = "2:00 PM - 4:00 PM"
        technicianName = "Sarah Wilson"
        contactNumber = "+27 11 123 4567"
    }
} | ConvertTo-Json -Depth 3

try {
    $result3 = Invoke-RestMethod -Uri "$baseUrl/trigger" -Method POST -Headers $headers -Body $body3
    Write-Host "✅ Service Change Scheduled email sent!" -ForegroundColor Green
    Write-Host "   Template used: $($result3.data.templateUsed)" -ForegroundColor White
} catch {
    Write-Host "❌ Failed to send Service Change Scheduled email" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Service Change Completed
Write-Host "`n4. Testing Service Change - Completed..." -ForegroundColor Yellow
$body4 = @{
    orderId = "test-uuid-002"
    orderType = "service_change"
    status = "completed"
    customerEmail = "xnxiweni@xnext.co.za"
    templateData = @{
        customerName = "Jesse Mashoana"
        orderNumber = "ORD-TEST-456"
        previousService = "Fiber 50Mbps"
        serviceType = "Fiber 200Mbps"
        address = "123 Main St, Johannesburg"
        completionDate = "October 20, 2025"
        downloadSpeed = "200 Mbps"
        uploadSpeed = "200 Mbps"
        supportNumber = "+27 11 123 4567"
        customerPortalUrl = "https://portal.example.com"
        billingNumber = "+27 11 123 4568"
    }
} | ConvertTo-Json -Depth 3

try {
    $result4 = Invoke-RestMethod -Uri "$baseUrl/trigger" -Method POST -Headers $headers -Body $body4
    Write-Host "✅ Service Change Completed email sent!" -ForegroundColor Green
    Write-Host "   Template used: $($result4.data.templateUsed)" -ForegroundColor White
} catch {
    Write-Host "❌ Failed to send Service Change Completed email" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎉 Testing complete! Check Jesse's email inbox." -ForegroundColor Cyan
Write-Host "📧 Email: xnxiweni@xnext.co.za" -ForegroundColor White
