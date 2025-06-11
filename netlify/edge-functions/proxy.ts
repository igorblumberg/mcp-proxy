// netlify/edge-functions/proxy.ts
export default async (request: Request) => {
  const targetUrl = 'https://my-dimona-mcp.igor-9a5.workers.dev'
  const url = new URL(request.url)
  
  // Forward the path after /proxy to your Worker
  const path = url.pathname.replace('/proxy', '') || '/'
  const proxyUrl = targetUrl + path + url.search
  
  console.log(`Proxying ${request.method} ${url.pathname} -> ${proxyUrl}`)

  // Clone headers and strip Content-Length: 0
  const headers = new Headers(request.headers)
  if (headers.get('Content-Length') === '0') {
    headers.delete('Content-Length')
    console.log('✅ Stripped Content-Length: 0 header')
  }

  try {
    const response = await fetch(proxyUrl, {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    })

    // Handle redirects in OAuth flow
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location')
      if (location) {
        // If redirect points to the original domain, rewrite to proxy domain
        const redirectUrl = new URL(location)
        if (redirectUrl.hostname === 'my-dimona-mcp.igor-9a5.workers.dev') {
          redirectUrl.hostname = url.hostname
          redirectUrl.pathname = '/proxy' + redirectUrl.pathname
          
          console.log(`🔄 Rewriting redirect: ${location} -> ${redirectUrl.toString()}`)
          
          return new Response(null, {
            status: response.status,
            headers: {
              ...Object.fromEntries(response.headers.entries()),
              'Location': redirectUrl.toString()
            }
          })
        }
      }
    }

    // Create response with all original headers
    const proxyResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })

    // Ensure CORS headers
    proxyResponse.headers.set('Access-Control-Allow-Origin', '*')
    proxyResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    proxyResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id')

    return proxyResponse
  } catch (error) {
    console.error('❌ Proxy error:', error)
    return new Response(JSON.stringify({ error: 'Proxy failed', details: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// This function will handle all /proxy/* paths
export const config = {
  path: "/proxy/*",
}