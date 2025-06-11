// netlify/edge-functions/proxy.ts
export default async (request: Request) => {
  const targetUrl = 'https://my-dimona-mcp.igor-9a5.workers.dev'
  const url = new URL(request.url)
  
  // Forward everything after /proxy/ to the target
  const path = url.pathname.replace('/proxy', '')
  const proxyUrl = targetUrl + path + url.search

  const headers = new Headers(request.headers)
  
  // Strip Content-Length: 0 
  if (headers.get('Content-Length') === '0') {
    headers.delete('Content-Length')
  }

  const response = await fetch(proxyUrl, {
    method: request.method,
    headers: headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  })

  return response
}

export const config = {
  path: "/proxy/*",
}