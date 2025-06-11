// netlify/edge-functions/proxy.ts
export default async (request: Request) => {
  const targetUrl = 'https://my-dimona-mcp.igor-9a5.workers.dev'
  const url = new URL(request.url)
  
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    console.log('🔀 Handling OPTIONS preflight request')
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Accept, Accept-Encoding',
        'Access-Control-Max-Age': '86400',
      }
    })
  }
  
  // Forward the path after /proxy to your Worker
  const path = url.pathname.replace('/proxy', '') || '/'
  
  // Special handling for .well-known paths that might be requested incorrectly
  const normalizedPath = path.replace(/\/sse\/.well-known/, '/.well-known')
  const proxyUrl = targetUrl + normalizedPath + url.search
  
  console.log(`Proxying ${request.method} ${url.pathname} -> ${proxyUrl}`)
  console.log(`Headers:`, Object.fromEntries(request.headers.entries()))

  // Clone headers and strip Content-Length: 0
  const headers = new Headers(request.headers)
  if (headers.get('Content-Length') === '0') {
    headers.delete('Content-Length')
    console.log('✅ Stripped Content-Length: 0 header')
  }

  // For OAuth metadata endpoints, request uncompressed response
  if (normalizedPath === '/.well-known/oauth-authorization-server' || 
      normalizedPath === '/.well-known/openid-configuration') {
    headers.set('Accept-Encoding', 'identity')
  }
  
  // Ensure proper host header
  headers.set('Host', 'my-dimona-mcp.igor-9a5.workers.dev')

  // For OAuth flow, we need to handle redirect_uri parameter
  let body: BodyInit | undefined = undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Check if this is an OAuth authorize or token request
    if (path === '/authorize' || path === '/token') {
      const contentType = headers.get('Content-Type')
      
      if (contentType?.includes('application/x-www-form-urlencoded')) {
        // Parse form data to check for redirect_uri
        const formData = await request.formData()
        const params = new URLSearchParams()
        
        for (const [key, value] of formData.entries()) {
          if (key === 'redirect_uri' && typeof value === 'string') {
            // Rewrite redirect_uri to use proxy URL
            const redirectUri = new URL(value)
            if (redirectUri.pathname.startsWith('/proxy/')) {
              // Already proxied, use as-is
              params.append(key, value)
            } else {
              // Add proxy prefix
              redirectUri.pathname = '/proxy' + redirectUri.pathname
              params.append(key, redirectUri.toString())
              console.log(`🔄 Rewriting redirect_uri: ${value} -> ${redirectUri.toString()}`)
            }
          } else {
            params.append(key, value.toString())
          }
        }
        
        const bodyString = params.toString()
        body = bodyString
        headers.set('Content-Length', bodyString.length.toString())
      } else if (contentType?.includes('application/json')) {
        // Handle JSON body
        const jsonBody = await request.json()
        if (jsonBody.redirect_uri) {
          const redirectUri = new URL(jsonBody.redirect_uri)
          if (!redirectUri.pathname.startsWith('/proxy/')) {
            redirectUri.pathname = '/proxy' + redirectUri.pathname
            jsonBody.redirect_uri = redirectUri.toString()
            console.log(`🔄 Rewriting JSON redirect_uri: ${jsonBody.redirect_uri}`)
          }
        }
        const bodyString = JSON.stringify(jsonBody)
        body = bodyString
        headers.set('Content-Length', bodyString.length.toString())
      } else {
        body = request.body
      }
    } else {
      body = request.body
    }
  }

  // Handle query parameters for GET requests (OAuth authorize)
  let finalProxyUrl = proxyUrl
  if (request.method === 'GET' && path === '/authorize') {
    const searchParams = new URLSearchParams(url.search)
    const redirectUri = searchParams.get('redirect_uri')
    
    if (redirectUri) {
      const parsedRedirectUri = new URL(redirectUri)
      if (!parsedRedirectUri.pathname.startsWith('/proxy/')) {
        parsedRedirectUri.pathname = '/proxy' + parsedRedirectUri.pathname
        searchParams.set('redirect_uri', parsedRedirectUri.toString())
        finalProxyUrl = targetUrl + path + '?' + searchParams.toString()
        console.log(`🔄 Rewriting GET redirect_uri in URL: ${finalProxyUrl}`)
      }
    }
  }

  try {
    const response = await fetch(finalProxyUrl, {
      method: request.method,
      headers: headers,
      body: body,
      // Disable automatic decompression so we can handle it manually
      compress: false,
    })

    // Handle redirects in OAuth flow
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location')
      if (location) {
        try {
          const redirectUrl = new URL(location)
          
          // If redirect points to the worker domain, rewrite to proxy domain
          if (redirectUrl.hostname === 'my-dimona-mcp.igor-9a5.workers.dev') {
            redirectUrl.hostname = url.hostname
            redirectUrl.port = url.port
            redirectUrl.protocol = url.protocol
            redirectUrl.pathname = '/proxy' + redirectUrl.pathname
            
            console.log(`🔄 Rewriting redirect: ${location} -> ${redirectUrl.toString()}`)
            
            const responseHeaders = new Headers(response.headers)
            responseHeaders.set('Location', redirectUrl.toString())
            
            return new Response(null, {
              status: response.status,
              headers: responseHeaders
            })
          }
          
          // If it's an OAuth callback (has code parameter), ensure it goes through proxy
          if (redirectUrl.searchParams.has('code') || redirectUrl.searchParams.has('error')) {
            // This might be an OAuth callback
            if (!redirectUrl.pathname.startsWith('/proxy/')) {
              const originalPath = redirectUrl.pathname
              redirectUrl.pathname = '/proxy' + originalPath
              
              console.log(`🔄 Rewriting OAuth callback: ${location} -> ${redirectUrl.toString()}`)
              
              const responseHeaders = new Headers(response.headers)
              responseHeaders.set('Location', redirectUrl.toString())
              
              return new Response(null, {
                status: response.status,
                headers: responseHeaders
              })
            }
          }
        } catch (e) {
          // If URL parsing fails, it might be a relative redirect
          if (!location.startsWith('http')) {
            const newLocation = '/proxy' + (location.startsWith('/') ? location : '/' + location)
            console.log(`🔄 Rewriting relative redirect: ${location} -> ${newLocation}`)
            
            const responseHeaders = new Headers(response.headers)
            responseHeaders.set('Location', newLocation)
            
            return new Response(null, {
              status: response.status,
              headers: responseHeaders
            })
          }
        }
      }
    }

    // For SSE responses, ensure proper headers
    if (normalizedPath === '/sse' || response.headers.get('Content-Type')?.includes('text/event-stream')) {
      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('Cache-Control', 'no-cache')
      responseHeaders.set('Connection', 'keep-alive')
      responseHeaders.set('X-Accel-Buffering', 'no')
      
      // CORS headers for SSE
      responseHeaders.set('Access-Control-Allow-Origin', '*')
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id')
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      })
    }

    // Handle OAuth metadata endpoint - rewrite URLs in response
    if (normalizedPath === '/.well-known/oauth-authorization-server' || 
        normalizedPath === '/.well-known/openid-configuration') {
      
      let text: string
      try {
        text = await response.text()
      } catch (e) {
        console.error('Failed to read response text:', e)
        // Try to read as arrayBuffer and convert
        const buffer = await response.arrayBuffer()
        const decoder = new TextDecoder()
        text = decoder.decode(buffer)
      }
      
      console.log(`OAuth metadata response: ${text.substring(0, 200)}...`)
      
      try {
        const metadata = JSON.parse(text)
        
        // Rewrite all URLs to go through proxy
        const urlFields = [
          'issuer',
          'authorization_endpoint',
          'token_endpoint',
          'registration_endpoint',
          'revocation_endpoint',
          'userinfo_endpoint',
          'jwks_uri'
        ]
        
        for (const field of urlFields) {
          if (metadata[field] && metadata[field].includes('my-dimona-mcp.igor-9a5.workers.dev')) {
            const originalUrl = new URL(metadata[field])
            originalUrl.hostname = url.hostname
            originalUrl.port = url.port
            originalUrl.protocol = url.protocol
            originalUrl.pathname = '/proxy' + originalUrl.pathname
            metadata[field] = originalUrl.toString()
            console.log(`🔄 Rewrote ${field}: ${metadata[field]}`)
          }
        }
        
        const responseHeaders = new Headers(response.headers)
        responseHeaders.set('Access-Control-Allow-Origin', '*')
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id')
        responseHeaders.set('Content-Type', 'application/json')
        responseHeaders.delete('content-encoding')
        responseHeaders.delete('content-length')
        
        const modifiedContent = JSON.stringify(metadata, null, 2)
        responseHeaders.set('Content-Length', modifiedContent.length.toString())
        
        return new Response(modifiedContent, {
          status: response.status,
          headers: responseHeaders
        })
      } catch (e) {
        console.error('Failed to parse OAuth metadata:', e)
        console.error('Raw text first 500 chars:', text.substring(0, 500))
        // If parsing fails, return the original text with CORS headers
        const responseHeaders = new Headers(response.headers)
        responseHeaders.set('Access-Control-Allow-Origin', '*')
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id')
        responseHeaders.delete('content-encoding')
        
        return new Response(text, {
          status: response.status,
          headers: responseHeaders
        })
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
    console.error('Stack trace:', error.stack)
    return new Response(JSON.stringify({ 
      error: 'Proxy failed', 
      details: error.message,
      path: normalizedPath,
      targetUrl: finalProxyUrl,
      method: request.method,
      headers: Object.fromEntries(headers.entries())
    }), { 
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id'
      }
    })
  }
}

// This function will handle all /proxy/* paths
export const config = {
  path: "/proxy/*",
}