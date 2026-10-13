import json
import logging
import time
import uuid
from starlette.responses import JSONResponse

logger = logging.getLogger('tiny_city.architect')
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(handler)

class RequestBoundary:
    def __init__(self, app, limit: int, cloud_save_limit: int | None = None):
        self.app, self.limit, self.cloud_save_limit = app, limit, cloud_save_limit or limit

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope,receive,send)
        request_id = uuid.uuid4().hex
        scope.setdefault('state',{})['request_id'] = request_id
        started = time.monotonic()
        status = 500
        async def send_response(message):
            nonlocal status
            if message['type'] == 'http.response.start':
                status = message['status']
                message['headers'].append((b'x-request-id',request_id.encode()))
            await send(message)
        try:
            if scope['method'] in {'POST', 'PUT', 'PATCH', 'DELETE'} and scope['path'].startswith('/v1/'):
                limit = self.cloud_save_limit if scope['path'].startswith('/v1/users/me/cities') else self.limit
                body = bytearray()
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return
                    body.extend(message.get('body',b''))
                    if len(body)>limit:
                        response=JSONResponse({'requestId':request_id,'error':{'code':'REQUEST_TOO_LARGE','message':'Request body exceeds the size limit.','retryable':False}},status_code=413)
                        return await response(scope,receive,send_response)
                    if not message.get('more_body',False):
                        break
                sent = False
                async def bounded_receive():
                    nonlocal sent
                    if not sent:
                        sent=True
                        return {'type':'http.request','body':bytes(body),'more_body':False}
                    return await receive()
                await self.app(scope,bounded_receive,send_response)
            else:
                await self.app(scope,receive,send_response)
        finally:
            logger.info(json.dumps({'event':'http_request','requestId':request_id,'status':status,'durationMs':round((time.monotonic()-started)*1000)}))


class SecurityHeaders:
    def __init__(self, app, secure: bool = False):
        self.app, self.secure = app, secure

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        async def add_headers(message):
            if message['type'] == 'http.response.start':
                headers = message.setdefault('headers', [])
                headers.extend([
                    (b'x-content-type-options', b'nosniff'),
                    (b'x-frame-options', b'DENY'),
                    (b'referrer-policy', b'strict-origin-when-cross-origin'),
                    (b'permissions-policy', b'camera=(), microphone=(), geolocation=()'),
                ])
                if self.secure:
                    headers.append((b'strict-transport-security', b'max-age=31536000; includeSubDomains'))
            await send(message)
        await self.app(scope, receive, add_headers)
