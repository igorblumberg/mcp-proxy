// netlify/edge-functions/proxy.ts
export default async (request: Request) => {
  const targetUrl = 'https://my-dimona-mcp.igor-9a5.workers.dev'
  const url = new URL(request.url)
  
  // Log incoming request
  console.log('>>> INCOMING REQUEST:', request.method, url.pathname + url.search)
  console.log('>>> Headers:')
  request.headers.forEach((value, key) => {
    console.log(`    ${key}: ${value}`)
  })
  
  // Build target URL
  const path = url.pathname.replace('/proxy', '') || '/'
  const targetUrlWithPath = targetUrl + path + url.search
  
  // Copy all headers except Content-Length: 0
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length' && value === '0') {
      console.log('!!! Stripping Content-Length: 0')
      return
    }
    // Skip host header - fetch will set it
    if (key.toLowerCase() === 'host') {
      return
    }
    headers.set(key, value)
  })
  
  // Log outgoing request
  console.log('<<< OUTGOING REQUEST:', request.method, targetUrlWithPath)
  console.log('<<< Headers:')
  headers.forEach((value, key) => {
    console.log(`    ${key}: ${value}`)
  })
  
  try {
    // Make the request - pass everything through
    const response = await fetch(targetUrlWithPath, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: 'manual',
    })
    
    // Log response
    console.log('>>> RESPONSE:', response.status, response.statusText)
    console.log('>>> Headers:')
    response.headers.forEach((value, key) => {
      console.log(`    ${key}: ${value}`)
    })
    
    // Return response exactly as received
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
    
  } catch (error) {
    console.error('!!! ERROR:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// Handle all /proxy/* paths
export const config = {
  path: "/proxy/*",
}