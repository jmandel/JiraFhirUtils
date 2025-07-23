#!/usr/bin/env bun

// Simple test script for the MCP HTTP wrapper

async function testMCPHttp() {
  const baseUrl = 'http://localhost:3001/mcp';
  
  console.log('🧪 Testing MCP HTTP Wrapper');
  console.log('================================');

  try {
    // Test 1: Initialize request (should create session)
    console.log('Test 1: Initialize request...');
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    };

    const initResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify(initRequest)
    });

    console.log(`Status: ${initResponse.status}`);
    console.log(`Headers:`, Object.fromEntries(initResponse.headers.entries()));
    
    if (initResponse.ok) {
      const initResult = await initResponse.json();
      console.log('Response:', JSON.stringify(initResult, null, 2));
      
      // Extract session ID
      const sessionId = initResponse.headers.get('Mcp-Session-Id');
      console.log(`Session ID: ${sessionId}`);

      if (sessionId) {
        // Test 2: List tools request
        console.log('\nTest 2: List tools request...');
        const toolsRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {}
        };

        const toolsResponse = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Mcp-Session-Id': sessionId
          },
          body: JSON.stringify(toolsRequest)
        });

        console.log(`Status: ${toolsResponse.status}`);
        if (toolsResponse.ok) {
          const toolsResult = await toolsResponse.json();
          console.log('Tools available:', toolsResult.result?.tools?.length || 0);
        }

        // Test 3: Test SSE stream
        console.log('\nTest 3: Test SSE stream...');
        const sseResponse = await fetch(baseUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
            'Mcp-Session-Id': sessionId
          }
        });

        console.log(`SSE Status: ${sseResponse.status}`);
        console.log(`SSE Content-Type: ${sseResponse.headers.get('Content-Type')}`);

        // Test 4: Clean up session
        console.log('\nTest 4: Delete session...');
        const deleteResponse = await fetch(baseUrl, {
          method: 'DELETE',
          headers: {
            'Mcp-Session-Id': sessionId
          }
        });

        console.log(`Delete Status: ${deleteResponse.status}`);
      }
    }

    console.log('\n✅ Tests completed');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Only run if this script is executed directly
if (import.meta.main) {
  testMCPHttp();
}