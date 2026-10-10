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
    def __init__(self, app, limit: int):
        self.app, self.limit = app, limit

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
            if scope['method'] == 'POST' and scope['path'].startswith('/v1/city/'):
                body = bytearray()
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return
                    body.extend(message.get('body',b''))
                    if len(body)>self.limit:
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
