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

class BuildRequest(WireModel):
    buildingType: BuildingType
    quantity: int = Field(ge=1, le=32)
    preferredPosition: Point | None = None

class MoveRequest(WireModel):
    buildingId: str = Field(min_length=1, max_length=128)
    position: Point

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

class Placement(WireModel):
    buildingId: str
    buildingType: BuildingType
    position: Point
    footprint: Footprint
    operation: Literal['build','move']

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
