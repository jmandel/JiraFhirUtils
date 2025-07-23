import { test, expect, mock, beforeEach, describe, spyOn } from "bun:test";
import type { 
  CallToolRequest, 
  CallToolResult, 
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';

// Test data fixtures
const mockIssueRecord = {
  issue_key: 'FHIR-123',
  project_key: 'FHIR',
  work_group: 'Terminology',
  title: 'Test Issue Title',
  description: 'Test issue description',
  summary: 'Test summary',
  resolution_description: 'Test resolution',
  resolution: 'Fixed',
  status: 'Resolved',
  assignee: 'john.doe',
  updated_at: '2023-12-01T10:00:00Z',
  issue_int: 123,
  related_url: 'https://example.com/spec.html',
  related_artifacts: 'artifact1, artifact2',
  related_pages: 'page1, page2',
};

const mockIssues = [
  mockIssueRecord,
  {
    issue_key: 'FHIR-124',
    project_key: 'FHIR',  
    work_group: 'Infrastructure',
    title: 'Another Test Issue',
    description: 'Another description',
    summary: 'Another summary',
    resolution_description: 'Another resolution',
    resolution: 'Wont Fix',
    status: 'Closed',
    assignee: 'jane.smith',
    updated_at: '2023-12-02T11:00:00Z',
    issue_int: 124,
  },
];

const mockCustomFields = [
  { field_name: 'Related Issues', field_value: 'FHIR-125, FHIR-126' },
  { field_name: 'Priority', field_value: 'High' },
];

const mockComments = [
  {
    issue_key: 'FHIR-123',
    created_at: '2023-12-01T12:00:00Z',
    author: 'john.doe',
    body: 'This is a test comment',
  },
];

const mockKeywords = [
  { keyword: 'terminology', tfidf_score: 0.85 },
  { keyword: 'validation', tfidf_score: 0.72 },
  { keyword: 'specification', tfidf_score: 0.68 },
];

const mockProjectKeys = [
  { project_key: 'FHIR' },
  { project_key: 'CDA' },
  { project_key: 'SMART' },
];

const mockWorkGroups = [
  { work_group: 'Terminology' },
  { work_group: 'Infrastructure' },
  { work_group: 'Clinical Decision Support' },
];

// Create mock database functionality
const createMockDb = () => {
  const mockStatement = {
    get: mock(),
    all: mock()
  };

  const mockDb = {
    prepare: mock(() => mockStatement),
    close: mock()
  };

  return { mockDb, mockStatement };
};

// Mock external modules using simple module replacement
mock.module('bun:sqlite', () => {
  const { mockDb } = createMockDb();
  return {
    Database: mock(() => mockDb)
  };
});

mock.module('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: mock(function() {
    return {
      setRequestHandler: mock(),
      connect: mock()
    };
  })
}));

mock.module('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: mock(() => ({}))
}));

mock.module('@jira-fhir-utils/database-utils', () => ({
  getDatabasePath: mock(() => Promise.resolve('/mock/path/to/db.sqlite')),
  setupDatabaseCliArgs: mock(() => Promise.resolve({}))
}));

describe('JiraIssuesMCPServer', () => {
  let JiraIssuesMCPServer: any;
  let server: any;
  let mockDb: any;
  let mockStatement: any;

  beforeEach(async () => {
    // Create fresh mocks
    const dbMocks = createMockDb();
    mockDb = dbMocks.mockDb;
    mockStatement = dbMocks.mockStatement;
    
    // Re-mock modules with fresh mocks
    mock.module('bun:sqlite', () => ({
      Database: mock(() => mockDb)
    }));

    mock.module('@jira-fhir-utils/database-utils', () => ({
      getDatabasePath: mock(() => Promise.resolve('/mock/path/to/db.sqlite')),
      setupDatabaseCliArgs: mock(() => Promise.resolve({}))
    }));

    // Import the class after setting up mocks
    const module = await import('./index.ts');
    JiraIssuesMCPServer = module.JiraIssuesMCPServer;
    
    // Create server instance
    server = new JiraIssuesMCPServer();
  });

  describe('Constructor', () => {
    test('should create server instance', () => {
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(JiraIssuesMCPServer);
    });
  });

  describe('Database initialization', () => {
    test('should initialize database connection', async () => {
      await server.init();
      // Verify that Database constructor was called (indirectly through getDatabasePath)
      expect(server.db).not.toBeNull();
    });
  });

  describe('Core functionality tests', () => {
    beforeEach(async () => {
      await server.init();
      // Setup default mock returns
      mockStatement.get.mockReturnValue(null);
      mockStatement.all.mockReturnValue([]);
    });

    describe('listIssues', () => {
      test('should return issues with no filters', async () => {
        mockStatement.all.mockReturnValue(mockIssues);
        
        const result = await server.listIssues({});
        
        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        
        const content = JSON.parse(result.content[0].text);
        expect(content.total).toBe(2);
        expect(content.issues).toEqual(mockIssues);
      });

      test('should filter by project_key', async () => {
        mockStatement.all.mockReturnValue([mockIssues[0]]);
        
        const result = await server.listIssues({ project_key: 'FHIR' });
        
        const content = JSON.parse(result.content[0].text);
        expect(content.total).toBe(1);
        expect(content.issues[0].project_key).toBe('FHIR');
      });

      test('should handle pagination', async () => {
        mockStatement.all.mockReturnValue([mockIssues[1]]);
        
        const result = await server.listIssues({ limit: 10, offset: 5 });
        
        const content = JSON.parse(result.content[0].text);
        expect(content.offset).toBe(5);
      });

      test('should handle database errors', async () => {
        mockStatement.all.mockImplementation(() => {
          throw new Error('Database query failed');
        });
        
        const result = await server.listIssues({});
        
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Error browsing work queue');
      });
    });

    describe('searchIssuesByKeywords', () => {
      test('should search with keywords', async () => {
        mockStatement.all.mockReturnValue([mockIssues[0]]);
        
        const result = await server.searchIssuesByKeywords({ keywords: 'terminology' });
        
        const content = JSON.parse(result.content[0].text);
        expect(content.keywords).toBe('terminology');
        expect(content.issues).toEqual([mockIssues[0]]);
      });

      test('should handle custom search fields', async () => {
        mockStatement.all.mockReturnValue([mockIssues[0]]);
        
        const result = await server.searchIssuesByKeywords({ 
          keywords: 'test',
          search_fields: ['title', 'description']
        });
        
        const content = JSON.parse(result.content[0].text);
        expect(content.search_fields).toEqual(['title', 'description']);
      });

      test('should handle database errors', async () => {
        mockStatement.all.mockImplementation(() => {
          throw new Error('Search failed');
        });
        
        const result = await server.searchIssuesByKeywords({ keywords: 'test' });
        
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Error searching for issues');
      });
    });

    describe('getIssueDetails', () => {
      test('should return issue details', async () => {
        mockStatement.get
          .mockReturnValueOnce(mockIssueRecord)  // issue details
          .mockReturnValueOnce({ count: 3 });    // comment count
        mockStatement.all.mockReturnValue(mockCustomFields); // custom fields
        
        const result = await server.getIssueDetails({ issue_key: 'FHIR-123' });
        
        const content = JSON.parse(result.content[0].text);
        expect(content.issue_key).toBe('FHIR-123');
        expect(content.custom_fields).toEqual({
          'Related Issues': 'FHIR-125, FHIR-126',
          'Priority': 'High'
        });
        expect(content.comment_count).toBe(3);
      });

      test('should handle non-existent issue', async () => {
        mockStatement.get.mockReturnValue(null);
        
        const result = await server.getIssueDetails({ issue_key: 'INVALID-999' });
        
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      });
    });

    describe('getIssueComments', () => {
      test('should return issue comments', async () => {
        mockStatement.all.mockReturnValue(mockComments);
        
        const result = await server.getIssueComments({ issue_key: 'FHIR-123' });
        
        const content = JSON.parse(result.content[0].text);
        expect(content.issue_key).toBe('FHIR-123');
        expect(content.total).toBe(1);
        expect(content.comments).toEqual(mockComments);
      });

      test('should handle empty comments', async () => {
        mockStatement.all.mockReturnValue([]);
        
        const result = await server.getIssueComments({ issue_key: 'FHIR-123' });
        
        const content = JSON.parse(result.content[0].text);
        expect(content.total).toBe(0);
        expect(content.comments).toEqual([]);
      });
    });

    describe('listRelatedIssues', () => {
      test('should find related issues', async () => {
        mockStatement.get
          .mockReturnValueOnce(mockIssueRecord)  // source issue
          .mockReturnValueOnce({ field_value: 'FHIR-125, FHIR-126' }); // linked issues
        
        mockStatement.all
          .mockReturnValueOnce(mockKeywords)  // keywords
          .mockReturnValueOnce([{ issue_key: 'FHIR-127' }]); // related issues
        
        const result = await server.listRelatedIssues({ issue_key: 'FHIR-123' });
        
        const content = JSON.parse(result.content[0].text);
        expect(content.issue_key).toBe('FHIR-123');
        expect(content.total_linked).toBe(2);
        expect(content.issues_linked).toEqual(['FHIR-125', 'FHIR-126']);
      });

      test('should handle non-existent source issue', async () => {
        mockStatement.get.mockReturnValue(null);
        
        const result = await server.listRelatedIssues({ issue_key: 'INVALID-999' });
        
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Source issue not found');
      });
    });

    describe('listProjectKeys', () => {
      test('should return project keys', async () => {
        mockStatement.all.mockReturnValue(mockProjectKeys);
        
        const result = await server.listProjectKeys();
        
        const content = JSON.parse(result.content[0].text);
        expect(content.total).toBe(3);
        expect(content.project_keys).toEqual(['FHIR', 'CDA', 'SMART']);
      });
    });

    describe('listWorkGroups', () => {
      test('should return work groups', async () => {
        mockStatement.all.mockReturnValue(mockWorkGroups);
        
        const result = await server.listWorkGroups();
        
        const content = JSON.parse(result.content[0].text);
        expect(content.total).toBe(3);
        expect(content.work_groups).toEqual(['Terminology', 'Infrastructure', 'Clinical Decision Support']);
      });
    });
  });

  describe('Error handling', () => {
    test('should throw error when database not initialized', async () => {
      const uninitializedServer = new JiraIssuesMCPServer();
      
      await expect(uninitializedServer.listIssues({})).rejects.toThrow('Database not initialized');
    });

    test('should handle empty results gracefully', async () => {
      await server.init();
      mockStatement.all.mockReturnValue([]);
      
      const result = await server.listIssues({});
      
      const content = JSON.parse(result.content[0].text);
      expect(content.total).toBe(0);
      expect(content.issues).toEqual([]);
    });
  });
});