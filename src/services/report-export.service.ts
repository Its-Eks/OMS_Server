import fs from 'fs';
import path from 'path';
import { AnalyticsService } from './analytics.service.ts';

// Define types locally to avoid import issues
export interface ReportFilters {
  dateRange?: {
    start: string;
    end: string;
  };
  orderTypes?: string[];
  serviceTypes?: string[];
  fnos?: string[];
  users?: string[];
  statuses?: string[];
  priorities?: string[];
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
}

export interface ExportOptions {
  format?: 'csv' | 'pdf' | 'excel' | 'json';
  includeCharts?: boolean;
  includeRawData?: boolean;
  customFields?: string[];
}

export interface ExportResult {
  url: string;
  filename: string;
  expiresAt: string;
  filePath: string;
}

export class ReportExportService {
  private analyticsService: AnalyticsService;
  private reportsDir: string;

  constructor(analyticsService: AnalyticsService) {
    this.analyticsService = analyticsService;
    this.reportsDir = path.join(process.cwd(), 'reports');
    this.ensureReportsDirectory();
  }

  private ensureReportsDirectory(): void {
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  async exportReport(
    reportType: string,
    filters?: ReportFilters,
    exportOptions?: ExportOptions
  ): Promise<ExportResult> {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${reportType}_${timestamp}.${exportOptions?.format || 'csv'}`;
    const filePath = path.join(this.reportsDir, filename);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    try {
      // Get the data based on report type
      const data = await this.getReportData(reportType, filters);
      
      // Generate the file based on format
      await this.generateFile(data, filePath, exportOptions?.format || 'csv');

      return {
        url: `/api/analytics/reports/download/${filename}`,
        filename,
        expiresAt,
        filePath
      };
    } catch (error) {
      console.error('Error generating report:', error);
      throw new Error(`Failed to generate report: ${error.message}`);
    }
  }

  private async getReportData(reportType: string, filters?: ReportFilters): Promise<any> {
    switch (reportType) {
      case 'kpi-summary':
        return await this.analyticsService.getKPIMetrics(filters);
      case 'order-analytics':
        return await this.analyticsService.getOrderAnalytics(filters);
      case 'customer-insights':
        return await this.analyticsService.getCustomerInsights(filters);
      case 'fno-performance':
        return await this.analyticsService.getFNOPerformance(filters);
      case 'escalation-analysis':
        return await this.analyticsService.getEscalationAnalysis(filters);
      case 'system-health':
        return await this.analyticsService.getSystemHealth(filters);
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  }

  private async generateFile(data: any, filePath: string, format: string): Promise<void> {
    switch (format.toLowerCase()) {
      case 'csv':
        await this.generateCSV(data, filePath);
        break;
      case 'json':
        await this.generateJSON(data, filePath);
        break;
      case 'pdf':
        await this.generatePDF(data, filePath);
        break;
      case 'excel':
        await this.generateExcel(data, filePath);
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private async generateCSV(data: any, filePath: string): Promise<void> {
    const csvContent = this.convertToCSV(data);
    fs.writeFileSync(filePath, csvContent, 'utf8');
  }

  private async generateJSON(data: any, filePath: string): Promise<void> {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async generatePDF(data: any, filePath: string): Promise<void> {
    // For now, generate a simple text-based PDF
    // In production, you'd use a library like puppeteer or pdfkit
    const content = this.convertToText(data);
    const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length ${content.length}
>>
stream
BT
/F1 12 Tf
72 720 Td
(${content.replace(/[()\\]/g, '\\$&')}) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000204 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
${content.length + 300}
%%EOF`;
    
    fs.writeFileSync(filePath, pdfContent, 'binary');
  }

  private async generateExcel(data: any, filePath: string): Promise<void> {
    // For now, generate CSV format (Excel can open CSV)
    // In production, you'd use a library like xlsx
    await this.generateCSV(data, filePath);
  }

  private convertToCSV(data: any): string {
    const flatten = (obj: any, prefix = ''): any[] => {
      const result: any[] = [];
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const newKey = prefix ? `${prefix}.${key}` : key;
          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            result.push(...flatten(obj[key], newKey));
          } else {
            result.push({ key: newKey, value: obj[key] });
          }
        }
      }
      return result;
    };

    const flattened = flatten(data);
    const headers = ['Metric', 'Value'];
    const rows = flattened.map(item => [item.key, item.value]);
    
    return [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  private convertToText(data: any): string {
    const formatValue = (value: any, indent = 0): string => {
      const spaces = '  '.repeat(indent);
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          return value.map(item => formatValue(item, indent + 1)).join('\n');
        } else {
          return Object.entries(value)
            .map(([key, val]) => `${spaces}${key}: ${formatValue(val, indent + 1)}`)
            .join('\n');
        }
      }
      return String(value);
    };

    return formatValue(data);
  }

  async getReportFile(filename: string): Promise<{ filePath: string; exists: boolean }> {
    const filePath = path.join(this.reportsDir, filename);
    const exists = fs.existsSync(filePath);
    return { filePath, exists };
  }

  async cleanupExpiredReports(): Promise<void> {
    const files = fs.readdirSync(this.reportsDir);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = path.join(this.reportsDir, file);
      const stats = fs.statSync(filePath);
      const age = now - stats.mtime.getTime();
      
      // Delete files older than 24 hours
      if (age > 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up expired report: ${file}`);
      }
    }
  }
}
