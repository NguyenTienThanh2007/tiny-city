"""Owner-scoped cloud snapshots. The simulation remains authoritative when a snapshot is loaded."""
from datetime import datetime
import json
import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .auth_routes import AuthContext, require_verified
from .database import get_db
from .models import UserCitySave
from .security import ApiError, csrf_dependency, utcnow

router = APIRouter(prefix='/v1/users/me/cities', tags=['cloud saves'])


class CitySaveBody(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    snapshot: dict

    @model_validator(mode='after')
    def validate_snapshot(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError('A city name is required.')
        try:
            encoded = json.dumps(self.snapshot, allow_nan=False, separators=(',', ':'))
        except (TypeError, ValueError):
            raise ValueError('Snapshot must contain JSON-safe values.') from None
        if len(encoded.encode('utf-8')) > 8_388_608:
            raise ValueError('Snapshot is too large.')
        snapshot = self.snapshot
        simulation = snapshot.get('simulation')
        if snapshot.get('saveVersion') != 3 or not isinstance(simulation, dict) or simulation.get('schemaVersion') != 2:
            raise ValueError('Only supported TINY CITY save schema 3 / simulation schema 2 snapshots are accepted.')
        plan = simulation.get('plan')
        budget = simulation.get('budget')
        clock = simulation.get('clock')
        if not isinstance(plan, dict) or not isinstance(budget, dict) or not isinstance(clock, dict):
            raise ValueError('Snapshot is missing required simulation data.')
        width, height = plan.get('width'), plan.get('height')
        if not isinstance(width, int) or not isinstance(height, int) or not (1 <= width <= 256 and 1 <= height <= 256):
            raise ValueError('Snapshot map dimensions are invalid.')
        if not isinstance(plan.get('buildings'), list) or len(plan['buildings']) > 4096 or \
           not isinstance(plan.get('roads'), list) or len(plan['roads']) > 65_536 or \
           not isinstance(plan.get('blockedTiles'), list) or len(plan['blockedTiles']) > 65_536:
            raise ValueError('Snapshot map data is invalid or too large.')
        for key in ('balance', 'openingBalance', 'totalSpent'):
            value = budget.get(key)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                raise ValueError('Snapshot budget is invalid.')
        tick = clock.get('tick')
        if not isinstance(tick, int) or isinstance(tick, bool) or tick < 0:
            raise ValueError('Snapshot simulation clock is invalid.')
        return self


class UpdateCitySaveBody(CitySaveBody):
    expected_revision: int = Field(ge=1)


def timestamp(value: datetime) -> str:
    return value.isoformat() + 'Z'


def summary(item: UserCitySave) -> dict:
    return {'id': item.id, 'name': item.name, 'schemaVersion': item.schema_version, 'revision': item.revision,
        'createdAt': timestamp(item.created_at), 'updatedAt': timestamp(item.updated_at)}


def encoded_snapshot(body: CitySaveBody, request: Request) -> str:
    value = json.dumps(body.snapshot, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    if len(value.encode('utf-8')) > request.app.state.settings.max_cloud_save_bytes:
        raise ApiError(413, 'SAVE_TOO_LARGE', 'This city save is larger than the configured upload limit.')
    return value


@router.get('')
def list_cities(context: AuthContext = Depends(require_verified), db: Session = Depends(get_db)):
    rows = db.scalars(select(UserCitySave).where(UserCitySave.user_id == context.user.id)
        .order_by(UserCitySave.updated_at.desc())).all()
    return {'saves': [summary(item) for item in rows]}


@router.post('', status_code=201, dependencies=[Depends(csrf_dependency)])
def create_city(body: CitySaveBody, request: Request, context: AuthContext = Depends(require_verified), db: Session = Depends(get_db)):
    settings = request.app.state.settings
    count = db.scalar(select(func.count(UserCitySave.id)).where(UserCitySave.user_id == context.user.id)) or 0
    if count >= settings.max_user_city_saves:
        raise ApiError(409, 'SAVE_LIMIT_REACHED', 'Delete a city save before creating another one.')
    now = utcnow()
    item = UserCitySave(id=str(uuid.uuid4()), user_id=context.user.id, name=body.name,
        snapshot_json=encoded_snapshot(body, request), schema_version=body.snapshot['saveVersion'],
        revision=1, created_at=now, updated_at=now)
    db.add(item)
    db.commit()
    return summary(item)


@router.get('/{save_id}')
def get_city(save_id: str, context: AuthContext = Depends(require_verified), db: Session = Depends(get_db)):
    item = db.scalar(select(UserCitySave).where(UserCitySave.id == save_id, UserCitySave.user_id == context.user.id))
    if item is None:
        raise ApiError(404, 'CITY_SAVE_NOT_FOUND', 'That city save was not found.')
    try:
        snapshot = json.loads(item.snapshot_json)
    except (TypeError, ValueError):
        raise ApiError(409, 'CITY_SAVE_CORRUPT', 'This city save cannot be read safely.') from None
    return {'save': summary(item), 'snapshot': snapshot}


@router.put('/{save_id}', dependencies=[Depends(csrf_dependency)])
def update_city(save_id: str, body: UpdateCitySaveBody, request: Request,
                context: AuthContext = Depends(require_verified), db: Session = Depends(get_db)):
    now = utcnow()
    result = db.execute(update(UserCitySave).where(
        UserCitySave.id == save_id, UserCitySave.user_id == context.user.id,
        UserCitySave.revision == body.expected_revision).values(
            name=body.name, snapshot_json=encoded_snapshot(body, request),
            schema_version=body.snapshot['saveVersion'], revision=body.expected_revision + 1, updated_at=now))
    if result.rowcount != 1:
        db.rollback()
        exists = db.scalar(select(UserCitySave.id).where(UserCitySave.id == save_id, UserCitySave.user_id == context.user.id))
        if exists is None:
            raise ApiError(404, 'CITY_SAVE_NOT_FOUND', 'That city save was not found.')
        raise ApiError(409, 'CITY_SAVE_CONFLICT', 'This cloud save changed elsewhere. Reload its latest revision before updating.')
    db.commit()
    item = db.scalar(select(UserCitySave).where(UserCitySave.id == save_id, UserCitySave.user_id == context.user.id))
    return summary(item)


@router.delete('/{save_id}', status_code=204, dependencies=[Depends(csrf_dependency)])
def delete_city(save_id: str, context: AuthContext = Depends(require_verified), db: Session = Depends(get_db)):
    item = db.scalar(select(UserCitySave).where(UserCitySave.id == save_id, UserCitySave.user_id == context.user.id))
    if item is None:
        raise ApiError(404, 'CITY_SAVE_NOT_FOUND', 'That city save was not found.')
    db.delete(item)
    db.commit()
