"""Version-1 wire schemas. Geometry and prices belong exclusively to TypeScript."""
from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=128)]
Description = Annotated[str, Field(max_length=256)]

BuildingType = Literal['villa','duplex','townhouse','apartment','park','clubhouse','pool','mall','office']

class WireModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

    @model_validator(mode='before')
    @classmethod
    def strict_version(cls, value):
        if isinstance(value, dict) and 'contractVersion' in value and type(value['contractVersion']) is not int:
            raise ValueError('Contract version must be an integer.')
        return value

class Point(WireModel):
    x: int = Field(ge=-(2**53-1), le=2**53-1)
    y: int = Field(ge=-(2**53-1), le=2**53-1)

class Region(Point):
    width: int = Field(ge=1, le=2**53-1)
    height: int = Field(ge=1, le=2**53-1)

class BuildDesign(WireModel):
    """Visual World 3.1: a requested architecture (registry ID or display name). The TS planner resolves it and
    refuses unknown or unavailable models; geometry, prices and rules never depend on it."""
    collection: Annotated[str, Field(min_length=1, max_length=96)] | None = None
    model: Annotated[str, Field(min_length=1, max_length=96)] | None = None

class BuildRequest(WireModel):
    buildingType: BuildingType
    quantity: int = Field(ge=1, le=32)
    preferredPosition: Point | None = None
    design: BuildDesign | None = None

class MoveRequest(WireModel):
    buildingId: str = Field(min_length=1, max_length=128)
    position: Point

class TargetSelector(WireModel):
    """Which existing buildings a command means; resolved deterministically by the TypeScript planner."""
    buildingType: BuildingType | None = None
    ids: list[Identifier] = Field(default_factory=list, max_length=32)
    quantity: int = Field(default=1, ge=1, le=32)
    all: bool = False
    relative: Literal['left','right','back','front'] | None = None

class MoveTarget(WireModel):
    target: TargetSelector
    near: Literal['existing','park','road','center'] = 'existing'
    position: Point | None = None

class ArchitectIntent(WireModel):
    summary: str = Field(min_length=1, max_length=512)
    language: Literal['en','vi']
    style: Literal['compact','coastal','mixed'] = 'compact'
    near: Literal['existing','park','road','center'] = 'existing'
    region: Region | None = None
    budgetLimit: int | None = Field(default=None, ge=0, le=2**53-1)
    connectRoads: bool = True
    builds: list[BuildRequest] = Field(default_factory=list, max_length=32)
    moves: list[MoveRequest] = Field(default_factory=list, max_length=32)
    demolish: list[Identifier] = Field(default_factory=list, max_length=128)
    roadAdd: list[Point] = Field(default_factory=list, max_length=128)
    roadRemove: list[Point] = Field(default_factory=list, max_length=128)
    preserveBuildingIds: list[Identifier] = Field(default_factory=list, max_length=128)
    unsupportedRequests: list[Description] = Field(default_factory=list, max_length=32)
    ambiguities: list[Description] = Field(default_factory=list, max_length=32)
    demolishTargets: list[TargetSelector] = Field(default_factory=list, max_length=16)
    moveTargets: list[MoveTarget] = Field(default_factory=list, max_length=16)
    preserveRoads: bool = False
    preserveTypes: list[BuildingType] = Field(default_factory=list, max_length=9)

class PlanningConstraints(WireModel):
    allowPartial: bool = False
    allowDestructive: bool = False
    allowedDemolitions: list[Identifier] = Field(default_factory=list, max_length=128)
    allowedRoadRemovals: list[Point] = Field(default_factory=list, max_length=128)
    preserveBuildingIds: list[Identifier] = Field(default_factory=list, max_length=128)
    budgetLimit: int | None = Field(default=None, ge=0, le=2**53-1)
    maxOperations: int = Field(default=128, ge=1, le=128)

class PlanningRequest(WireModel):
    contractVersion: Literal[1]
    prompt: str = Field(min_length=1, max_length=4000)
    world: dict[str, Any]
    sourceRevision: int = Field(ge=0, le=2**53-1)
    seed: int = Field(default=0, ge=0, le=2**32-1)
    constraints: PlanningConstraints = Field(default_factory=PlanningConstraints)

    @field_validator('prompt')
    @classmethod
    def nonempty_prompt(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('Prompt must not be blank.')
        return value

class ValidationRequest(WireModel):
    contractVersion: Literal[1]
    world: dict[str, Any]
    sourceRevision: int = Field(ge=0, le=2**53-1)
    seed: int = Field(default=0, ge=0, le=2**32-1)
    constraints: PlanningConstraints = Field(default_factory=PlanningConstraints)
    intent: ArchitectIntent

class Warning(WireModel):
    code: str
    message: str

class Footprint(WireModel):
    width: int
    height: int

class PlacementDesign(WireModel):
    collection: str = Field(min_length=1, max_length=48)
    model: str = Field(min_length=1, max_length=96)

class Placement(WireModel):
    buildingId: str
    buildingType: BuildingType
    position: Point
    footprint: Footprint
    operation: Literal['build','move']
    design: PlacementDesign | None = None

class Roads(WireModel):
    add: list[Point]
    remove: list[Point]

class PlanValidation(WireModel):
    valid: bool
    fulfilled: bool
    operationCount: int

class BuildCommand(WireModel):
    type: Literal['city.build']
    buildingType: BuildingType
    position: Point

class MoveCommand(WireModel):
    type: Literal['city.move-building']
    buildingId: str
    position: Point

class DemolishCommand(WireModel):
    type: Literal['city.demolish']
    buildingId: str

class RoadCommand(WireModel):
    type: Literal['city.edit-roads']
    add: list[Point]
    remove: list[Point]

CityCommand = Annotated[BuildCommand | MoveCommand | DemolishCommand | RoadCommand, Field(discriminator='type')]

class TargetCandidate(WireModel):
    buildingId: str
    name: str
    buildingType: BuildingType | None
    position: Point

class PlanClarification(WireModel):
    kind: Literal['demolish','move']
    index: int
    quantity: int
    message: str
    candidates: list[TargetCandidate]

class PlanAuthorization(WireModel):
    demolish: list[str]
    move: list[str]
    protectedIds: list[str]
    destructiveRequired: bool
    message: str

class PlanImpact(WireModel):
    buildingsAdded: int
    buildingsRemoved: int
    buildingsMoved: int
    roomsAdded: int
    roomsRemoved: int
    residentsRemoved: int
    residentsRehoused: int
    playerHomeRemoved: bool

class PlanProposal(WireModel):
    contractVersion: Literal[1]
    planId: str
    digest: str
    sourceWorldId: str
    sourceRevision: int
    sourceFingerprint: str
    seed: int
    status: Literal['VALIDATED','REJECTED']
    summary: str
    explanation: str
    intent: ArchitectIntent
    constraints: PlanningConstraints
    placements: list[Placement]
    roads: Roads
    projectedPlan: dict[str, Any]
    estimatedCost: int
    projectedBudget: int
    validation: PlanValidation
    warnings: list[Warning]
    commands: list[CityCommand]
    clarifications: list[PlanClarification]
    authorization: PlanAuthorization | None
    impact: PlanImpact

class PlanningResponse(WireModel):
    requestId: str
    proposal: PlanProposal

class ErrorDetail(WireModel):
    code: str
    message: str
    retryable: bool

class ErrorResponse(WireModel):
    requestId: str
    error: ErrorDetail


class ProviderStatus(BaseModel):
    mode: Literal['gemini', 'mock', 'local', 'custom']
    configured: bool
    # Non-secret model name (Gemini only), so a misconfigured model is visible without revealing credentials.
    model: str | None = None


class PlannerStatusResponse(BaseModel):
    status: Literal['ok'] = 'ok'
    # Identity lets clients tell this API apart from another service answering on the same port.
    service: Literal['tiny-city-api'] = 'tiny-city-api'
    contractVersion: Literal[1] = 1
    provider: ProviderStatus
    planner: Literal['ready', 'not-built']
