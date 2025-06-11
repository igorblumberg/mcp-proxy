// netlify/edge-functions/proxy.ts
export default async (request: Request) => {
  const targetUrl = 'https://my-dimona-mcp.igor-9a5.workers.dev'
  const url = new URL(request.url)
  
  console.log('>>> REQUEST:', request.method, url.pathname)
  
  // Build target URL
  const targetUrlWithPath = targetUrl + url.pathname + url.search
  
  // Copy headers, excluding problematic ones
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    
    // Skip Content-Length: 0
    if (lowerKey === 'content-length' && value === '0') {
      console.log('!!! Stripping Content-Length: 0')
      return
    }
    
    // Skip headers that shouldn't be forwarded
    if (lowerKey === 'host' || 
        lowerKey.startsWith('x-nf-') || 
        lowerKey === 'cdn-loop' ||
        lowerKey === 'x-forwarded-for' ||
        lowerKey === 'x-cloud-trace-context' ||
        lowerKey === 'traceparent') {
      return
    }
    
    headers.set(key, value)
  })
  
  console.log('<<< PROXYING TO:', targetUrlWithPath)
  
  try {
    // Make the request
    const response = await fetch(targetUrlWithPath, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: 'manual',
    })
    
    console.log('>>> RESPONSE:', response.status)
    
    // Special handling for OAuth metadata endpoints
    if (url.pathname === '/.well-known/oauth-authorization-server' || 
        url.pathname === '/.well-known/openid-configuration') {
      
      console.log('!!! OAuth metadata endpoint detected')
      
      const text = await response.text()
      console.log('Original metadata:', text)
      
      try {
        const metadata = JSON.parse(text)
        
        // Replace all Cloudflare URLs with proxy URLs
        const jsonString = JSON.stringify(metadata)
        const modifiedJson = jsonString.replace(
          /https:\/\/my-dimona-mcp\.igor-9a5\.workers\.dev/g,
          'https://dimonamcpproxy.netlify.app'
        )
        
        const modifiedMetadata = JSON.parse(modifiedJson)
        console.log('Modified metadata:', JSON.stringify(modifiedMetadata, null, 2))
        
        return new Response(JSON.stringify(modifiedMetadata, null, 2), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        })
      } catch (e) {
        console.error('Failed to process OAuth metadata:', e)
        // Return original response if processing fails
        return new Response(text, {
          status: response.status,
          headers: response.headers
        })
      }
    }
    
    // For all other requests, return as-is
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
    
  } catch (error) {
    console.error('!!! PROXY ERROR:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// Handle all paths
export const config = {
  path: "/*",
}