#!/usr/bin/env bun

// Test script for the MCP HTTP wrapper to verify the fixes

const SERVER_URL = 'http://localhost:3000/mcp';

async function testMCPHttpWrapper() {
  console.log('Testing MCP HTTP wrapper...');
  
  try {
    // Test 1: Initialize MCP connection
    console.log('1. Testing initialization...');
    const initResponse = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            roots: { listChanged: true }
          },
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        }
      })
    });
    
    if (!initResponse.ok) {
      throw new Error(`Init request failed: ${initResponse.status} ${initResponse.statusText}`);
    }
    
    const sessionId = initResponse.headers.get('Mcp-Session-Id');
    console.log('✓ Initialization successful, session ID:', sessionId);
    
    const initResult = await initResponse.json();
    console.log('✓ Init response:', JSON.stringify(initResult, null, 2));
    
    // Test 2: List tools
    console.log('\n2. Testing list tools...');
    const toolsResponse = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Mcp-Session-Id': sessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      })
    });
    
    if (!toolsResponse.ok) {
      throw new Error(`Tools request failed: ${toolsResponse.status} ${toolsResponse.statusText}`);
    }
    
    const toolsResult = await toolsResponse.json();
    console.log('✓ Tools list:', JSON.stringify(toolsResult, null, 2));
    
    // Test 3: Test SSE stream
    console.log('\n3. Testing SSE stream...');
    const sseResponse = await fetch(SERVER_URL, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Mcp-Session-Id': sessionId
      }
    });
    
    if (!sseResponse.ok) {
      throw new Error(`SSE request failed: ${sseResponse.status} ${sseResponse.statusText}`);
    }
    
    console.log('✓ SSE stream connected');
    
    // Read a few events from the SSE stream
    const reader = sseResponse.body?.getReader();
    const decoder = new TextDecoder();
    let eventCount = 0;
    
    if (reader) {
      console.log('Reading SSE events...');
      const timeout = setTimeout(() => {
        reader.cancel();
        console.log('✓ SSE stream test completed (timeout)');
      }, 5000);
      
      try {
        while (eventCount < 3) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          console.log('SSE chunk:', chunk);
          eventCount++;
        }
      } catch (error) {
        console.log('SSE read completed:', error.message);
      } finally {
        clearTimeout(timeout);
        reader.cancel();
      }
    }
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testMCPHttpWrapper();