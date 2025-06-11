// netlify/edge-functions/proxy.ts
export default async (request: Request) => {
  const url = new URL(request.url)
  
  console.log('🚨 EDGE FUNCTION CALLED')
  console.log(`🚨 Method: ${request.method}, Full URL: ${url.href}`)
  console.log(`🚨 Pathname: ${url.pathname}`)
  
  // If not under /proxy, log and return 404
  if (!url.pathname.startsWith('/proxy')) {
    console.log('❌ Request not under /proxy path - possible OAuth discovery attempt?')
    return new Response('Not found', { status: 404 })
  }
  
  const targetUrl = 'https://my-dimona-mcp.igor-9a5.workers.dev'
  
  console.log('========== INCOMING REQUEST ==========')
  console.log(`Method: ${request.method}`)
  console.log(`URL: ${url.pathname}${url.search}`)
  console.log('Headers:')
  request.headers.forEach((value, key) => {
    console.log(`  ${key}: ${value}`)
  })
  
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
  const proxyUrl = targetUrl + path + url.search
  
  console.log(`\n🎯 Proxying to: ${proxyUrl}`)

  // Clone headers and process them
  const headers = new Headers()
  let contentLengthRemoved = false
  
  request.headers.forEach((value, key) => {
    // Skip Content-Length: 0 header
    if (key.toLowerCase() === 'content-length' && value === '0') {
      console.log('❌ REMOVING Content-Length: 0 header')
      contentLengthRemoved = true
      return
    }
    
    // Skip host header (will be set by fetch)
    if (key.toLowerCase() === 'host') {
      return
    }
    
    // Skip some Netlify-specific headers
    if (key.toLowerCase().startsWith('x-nf-') || 
        key.toLowerCase() === 'cdn-loop' ||
        key.toLowerCase() === 'x-forwarded-for') {
      console.log(`⏩ Skipping Netlify header: ${key}`)
      return
    }
    
    headers.set(key, value)
  })
  
  console.log('\n📤 OUTGOING HEADERS:')
  headers.forEach((value, key) => {
    console.log(`  ${key}: ${value}`)
  })

  // Handle request body
  let body: BodyInit | undefined = undefined
  
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // For POST/PUT requests, we need to handle the body
    const contentType = headers.get('Content-Type')
    
    if (contentLengthRemoved) {
      console.log('⚠️  Content-Length was 0, checking for actual body content...')
      
      try {
        const clonedRequest = request.clone()
        const bodyText = await clonedRequest.text()
        
        if (bodyText.length > 0) {
          console.log(`📝 Body has content (${bodyText.length} chars): ${bodyText.substring(0, 200)}...`)
          body = bodyText
          headers.set('Content-Length', bodyText.length.toString())
          console.log(`✅ Set new Content-Length: ${bodyText.length}`)
        } else {
          console.log('📭 Body is actually empty')
          // Don't set Content-Length, let fetch handle it
        }
      } catch (e) {
        console.log('⚠️  Error reading body:', e)
      }
    } else {
      // Normal body handling
      body = request.body
    }
  }

  try {
    console.log('\n🚀 Making request to Cloudflare Worker...')
    const response = await fetch(proxyUrl, {
      method: request.method,
      headers: headers,
      body: body,
      // Let fetch handle compression
      redirect: 'manual', // Handle redirects manually
    })

    console.log('\n========== RESPONSE ==========')
    console.log(`Status: ${response.status} ${response.statusText}`)
    console.log('Response Headers:')
    response.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`)
    })

    // Handle redirects
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location')
      if (location) {
        console.log(`🔄 Redirect to: ${location}`)
        
        // For OAuth flow, we might need to handle redirects specially
        // But for now, just pass them through
      }
    }

    // Log response body for errors
    if (response.status >= 400) {
      const responseClone = response.clone()
      try {
        const errorText = await responseClone.text()
        console.log(`\n❌ ERROR RESPONSE BODY: ${errorText}`)
      } catch (e) {
        console.log('Could not read error response body')
      }
    }

    // Create response with all original headers
    const proxyResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })

    // Add CORS headers
    proxyResponse.headers.set('Access-Control-Allow-Origin', '*')
    proxyResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    proxyResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id')

    console.log('\n✅ Request completed successfully')
    return proxyResponse
    
  } catch (error) {
    console.error('\n❌ PROXY ERROR:', error)
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      type: error.constructor.name
    })
    
    return new Response(JSON.stringify({ 
      error: 'Proxy failed', 
      details: error.message,
      path: path,
      targetUrl: proxyUrl,
      method: request.method,
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

// This function will handle all paths
export const config = {
  path: "/*",
}