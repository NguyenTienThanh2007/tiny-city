import type { BuildingType } from '@tiny-city/simulation';

/**
 * Visual World 3.1 architecture registry: which architectural collections and building models exist.
 *
 * Pure data shared by the Build UI, the renderer (which maps a model to its baked sprite), the AI Architect
 * (which validates requested styles) and the API (which lists them for the provider via `catalog.json`).
 * A design is purely cosmetic: every model of a building type keeps that type's catalog footprint, capacity,
 * cost and rules. IDs are stable strings and must never be renamed or reused; retire a model by marking it
 * `retired`, so saved cities that reference it still resolve.
 */
export type ArchitectureCollectionId = 'classic' | 'luxury-minimalist' | 'modern-coastal' | 'tropical-contemporary' | 'urban-premium' | 'family-garden';
/** `available`: baked and selectable. `planned`: listed with a "coming soon" note, never selectable. */
export type ArchitectureStatus = 'available' | 'planned' | 'retired';

export interface ArchitectureCollection {
  readonly id: ArchitectureCollectionId;
  readonly name: string;
  readonly nameVi: string;
  readonly tagline: string;
  readonly description: string;
  /** UI swatches (CSS hex) that summarise the material palette. */
  readonly palette: readonly string[];
  /** Lower-case phrases (English and Vietnamese) that name the collection in a request. */
  readonly aliases: readonly string[];
}

export interface ArchitectureModel {
  readonly id: string;
  readonly collection: ArchitectureCollectionId;
  readonly buildingType: BuildingType;
  readonly name: string;
  readonly nameVi: string;
  readonly description: string;
  /** Signature details shown in the catalog. */
  readonly features: readonly string[];
  readonly status: ArchitectureStatus;
  /** Lower-case phrases (besides the name) that name this model in a request. */
  readonly aliases?: readonly string[];
  /** Classic models: the 3.0B bake variant this model stands for. */
  readonly classicVariant?: number;
}

/** A building's persistent architectural identity (editor metadata; never affects simulation rules). */
export interface BuildingDesign {
  readonly collection: ArchitectureCollectionId;
  readonly model: string;
}

export const ARCHITECTURE_COLLECTIONS: readonly ArchitectureCollection[] = [
  { id: 'classic', name: 'Classic Coastal', nameVi: 'Cổ điển ven biển', tagline: 'The original Villa Gardens look',
    description: 'Pitched terracotta and slate roofs, shutters, porticoes and lettered shopfronts: the warm seaside town every city starts with.',
    palette: ['#faf1e2', '#c8674a', '#3f8d8a', '#5d6f78'], aliases: ['classic', 'classic coastal', 'cổ điển', 'truyền thống'] },
  { id: 'luxury-minimalist', name: 'Luxury Minimalist', nameVi: 'Tối giản sang trọng', tagline: 'Ivory, stone, walnut and glass',
    description: 'Horizontal rooflines, cantilevers and floor-to-ceiling glazing in ivory render, light concrete, natural stone and walnut, with charcoal metal, bronze accents and soft lighting.',
    palette: ['#f4efe6', '#d6d0c4', '#c9b79c', '#7a5236', '#3a3f43', '#b08d57'],
    aliases: ['luxury minimalist', 'luxury minimal', 'minimalist luxury', 'minimalist', 'tối giản sang trọng', 'tối giản cao cấp', 'tối giản', 'sang trọng tối giản'] },
  { id: 'modern-coastal', name: 'Modern Coastal', nameVi: 'Hiện đại ven biển', tagline: 'Board-and-batten, deep eaves, sea light',
    description: 'Crisp white board-and-batten, steep standing-seam gables, deep porches, weathered timber decks and dune planting.',
    palette: ['#f7f7f2', '#9fb7c4', '#4d6470', '#c9b28c'], aliases: ['modern coastal', 'coastal modern', 'hiện đại ven biển', 'ven biển hiện đại'] },
  { id: 'tropical-contemporary', name: 'Tropical Contemporary', nameVi: 'Nhiệt đới đương đại', tagline: 'Shade, slats and courtyards',
    description: 'Broad shading roofs, timber louvres, breeze-block screens, open-air courtyards, water and lush tropical planting.',
    palette: ['#efe6d6', '#8c6a46', '#4f7c52', '#2f3a33'], aliases: ['tropical contemporary', 'tropical modern', 'tropical', 'nhiệt đới đương đại', 'nhiệt đới hiện đại', 'nhiệt đới'] },
  { id: 'urban-premium', name: 'Urban Premium', nameVi: 'Đô thị cao cấp', tagline: 'Glass, fins and skyline crowns',
    description: 'Curtain walls, vertical fins, dark metal frames, illuminated crowns and paved urban plazas for a premium downtown.',
    palette: ['#dfe6ea', '#7f9bb0', '#2b3338', '#c9a46a'], aliases: ['urban premium', 'premium urban', 'urban', 'đô thị cao cấp', 'đô thị'] },
  { id: 'family-garden', name: 'Family Garden Homes', nameVi: 'Nhà vườn gia đình', tagline: 'Porches, gardens and play lawns',
    description: 'Friendly family homes with porches, pergolas, vegetable beds, play lawns and generous garden landscaping.',
    palette: ['#f6ead6', '#a8754c', '#7fa36b', '#c96f4f'], aliases: ['family garden', 'family garden homes', 'garden homes', 'nhà vườn', 'nhà vườn gia đình'] },
];

const classic = (buildingType: BuildingType, variant: number, slug: string, name: string, nameVi: string, description: string, features: string[]): ArchitectureModel =>
  ({ id: `classic.${buildingType}.${slug}`, collection: 'classic', buildingType, name, nameVi, description, features, status: 'available', classicVariant: variant });

export const ARCHITECTURE_MODELS: readonly ArchitectureModel[] = [
  // Classic Coastal: the Visual World 3.0B bakes, unchanged.
  classic('villa', 0, 'portico-pool', 'Portico Pool Villa', 'Biệt thự hiên cột hồ bơi', 'Hipped terracotta roof, columned portico and a plunge pool.', ['Columned portico', 'Plunge pool', 'Pergola terrace']),
  classic('villa', 1, 'slate-patio', 'Slate Patio Villa', 'Biệt thự sân hiên mái xám', 'Gabled slate roof over peach render with a timber patio.', ['Gabled slate roof', 'Timber patio', 'Olive tree']),
  classic('villa', 2, 'teal-garden', 'Teal Garden Villa', 'Biệt thự vườn mái xanh', 'Hipped teal roof with coral shutters and a flower garden.', ['Hipped teal roof', 'Flower garden', 'Jacaranda']),
  classic('villa', 3, 'cypress-pool', 'Cypress Pool Villa', 'Biệt thự hồ bơi hàng bách', 'Gabled terracotta roof, blue shutters, pool and cypresses.', ['Pool terrace', 'Cypress pair', 'Blue shutters']),
  classic('duplex', 0, 'olive-gables', 'Olive Twin Gables', 'Nhà song lập mái đôi ô liu', 'Twin standing-seam gables with timber-clad upper bays.', ['Twin gables', 'Timber cladding', 'Split gardens']),
  classic('duplex', 1, 'teal-gables', 'Teal Twin Gables', 'Nhà song lập mái đôi xanh', 'Teal gables over cream render, palms in the gardens.', ['Teal roofs', 'Upper balconies', 'Palms']),
  classic('duplex', 2, 'terracotta-gables', 'Terracotta Twin Gables', 'Nhà song lập mái đôi đất nung', 'Terracotta gables over pale grey render.', ['Terracotta roofs', 'Recessed entrances', 'Round trees']),
  classic('townhouse', 0, 'harbour-row', 'Harbour Row', 'Dãy phố cảng', 'Three narrow coastal houses with individual facades.', ['Individual facades', 'Street café', 'Roof variety']),
  classic('townhouse', 1, 'market-row', 'Market Row', 'Dãy phố chợ', 'A row with a ground-floor shop and brick and render fronts.', ['Shopfront', 'Brick facade', 'Window boxes']),
  classic('townhouse', 2, 'garden-row', 'Garden Row', 'Dãy phố vườn', 'A pastel row with stoops and planters.', ['Pastel fronts', 'Front stoops', 'Planters']),
  classic('apartment', 0, 'seabreeze', 'Seabreeze Residences', 'Chung cư Seabreeze', 'Terracotta bay, glass balconies and a corner café.', ['Coloured bay', 'Penthouse terrace', 'Corner café']),
  classic('apartment', 1, 'marina', 'Marina Residences', 'Chung cư Marina', 'Teal bay with railed balconies over a stone base.', ['Railed balconies', 'Stone base', 'Courtyard']),
  classic('apartment', 2, 'coral', 'Coral Residences', 'Chung cư Coral', 'Sage bay, glass balconies and jacaranda courtyard.', ['Sage bay', 'Glass balconies', 'Jacaranda']),
  classic('park', 0, 'fountain', 'Fountain Park', 'Công viên đài phun nước', 'Curving paths around a central fountain.', ['Fountain', 'Flowerbeds', 'Benches']),
  classic('park', 1, 'pond', 'Pond Park', 'Công viên hồ nước', 'A pond with a footbridge and willows.', ['Pond', 'Footbridge', 'Lawns']),
  classic('park', 2, 'pavilion', 'Pavilion Park', 'Công viên đình nghỉ', 'A garden pavilion on a lawn.', ['Pavilion', 'Mixed trees', 'Lamps']),
  classic('clubhouse', 0, 'garden-club', 'Garden Club', 'Câu lạc bộ Garden', 'Glazed pavilion with timber service volume.', ['Cantilevered roof', 'Roof garden', 'Leisure terrace']),
  classic('clubhouse', 1, 'lagoon-club', 'Lagoon Club', 'Câu lạc bộ Lagoon', 'Coral accents and walnut cladding.', ['Fire pit', 'Deck', 'Lettered sign']),
  classic('clubhouse', 2, 'cove-club', 'Cove Club', 'Câu lạc bộ Cove', 'Blue accents and honey timber.', ['Glazing', 'Loungers', 'Garden']),
  classic('pool', 0, 'lido', 'Lido Pool', 'Hồ bơi Lido', 'Lane pool, kids’ pool and teal cabana.', ['Lane pool', 'Diving board', 'Cabana']),
  classic('pool', 1, 'splash', 'Splash Pool', 'Hồ bơi Splash', 'Coral cabana and teal loungers.', ['Kids’ pool', 'Lifeguard chair', 'Umbrellas']),
  classic('mall', 0, 'harbour', 'Harbour Mall', 'Trung tâm Harbour', 'Lettered shopfronts with terracotta awnings around an atrium.', ['Glazed atrium', 'Awnings', 'Parking court']),
  classic('mall', 1, 'lagoon', 'Lagoon Mall', 'Trung tâm Lagoon', 'Teal accents, gallery and fountain plaza.', ['Fountain plaza', 'Gallery', 'Pylon sign']),
  classic('office', 0, 'tide', 'Tide Tower', 'Tòa Tide', 'Glass tower on a stone podium with ivory fins.', ['Curtain wall', 'Lit crown', 'Plaza']),
  classic('office', 1, 'nova', 'Nova Tower', 'Tòa Nova', 'Green glass with coral fins and palms.', ['Coral fins', 'Garden terrace', 'Palms']),
  classic('office', 2, 'helix', 'Helix Tower', 'Tòa Helix', 'Steel-blue glass with bronze fins.', ['Bronze fins', 'Mast', 'Lime trees']),

  // Luxury Minimalist: the 3.1 benchmark collection.
  { id: 'lm.villa.glass-pavilion', collection: 'luxury-minimalist', buildingType: 'villa', name: 'Glass Pavilion Villa', nameVi: 'Biệt thự Glass Pavilion', status: 'available',
    description: 'A single floating roof plane over walls of glass, walnut screens and a framed minimalist entrance in a refined garden.',
    features: ['Floating flat roof', 'Full-height glazing', 'Walnut screens', 'Reflecting pool'], aliases: ['glass pavilion', 'biệt thự kính'] },
  { id: 'lm.villa.sculptural-concrete', collection: 'luxury-minimalist', buildingType: 'villa', name: 'Sculptural Concrete Villa', nameVi: 'Biệt thự Sculptural Concrete', status: 'available',
    description: 'Asymmetric concrete volumes with a dramatic cantilevered upper storey, tall slot glazing and architectural light lines.',
    features: ['Cantilevered upper storey', 'Board-formed concrete', 'Slot glazing', 'Light lines'], aliases: ['sculptural concrete', 'concrete villa', 'biệt thự bê tông'] },
  { id: 'lm.villa.minimal-courtyard', collection: 'luxury-minimalist', buildingType: 'villa', name: 'Minimal Courtyard Villa', nameVi: 'Biệt thự Minimal Courtyard', status: 'available',
    description: 'An L-shaped home wrapped around a private courtyard tree, with timber screening, a framed portal entrance and stone stepping paths.',
    features: ['Private courtyard', 'Timber screening', 'Portal entrance', 'Stone paths'], aliases: ['minimal courtyard', 'courtyard villa', 'biệt thự sân trong'] },
  { id: 'lm.villa.sky-terrace', collection: 'luxury-minimalist', buildingType: 'villa', name: 'Sky Terrace Villa', nameVi: 'Biệt thự Sky Terrace', status: 'available',
    description: 'A stepped two-storey villa crowned by a generous terrace with glass balustrades, a slim pergola and rooftop planting.',
    features: ['Upper sky terrace', 'Glass balustrades', 'Slim pergola', 'Rooftop greenery'], aliases: ['sky terrace', 'biệt thự sân thượng'] },
  { id: 'lm.villa.linear-modern', collection: 'luxury-minimalist', buildingType: 'villa', name: 'Linear Modern Villa', nameVi: 'Biệt thự Linear Modern', status: 'available',
    description: 'A long, low composition of layered volumes and a natural stone wall, with a refined entry canopy and a lap pool.',
    features: ['Layered horizontal volumes', 'Stone feature wall', 'Entry canopy', 'Lap pool'], aliases: ['linear modern', 'linear villa', 'biệt thự ngang'] },
  { id: 'lm.villa.tropical-minimalist', collection: 'luxury-minimalist', buildingType: 'villa', name: 'Tropical Minimalist Villa', nameVi: 'Biệt thự Tropical Minimalist', status: 'available',
    description: 'Clean minimalist forms shaded by deep balconies and timber sun slats, opening onto a tropical courtyard.',
    features: ['Shaded balconies', 'Timber sun slats', 'Tropical courtyard', 'Indoor–outdoor living'], aliases: ['tropical minimalist', 'biệt thự nhiệt đới tối giản'] },
  { id: 'lm.duplex.twin-glass', collection: 'luxury-minimalist', buildingType: 'duplex', name: 'Twin Glass Duplex', nameVi: 'Nhà song lập Twin Glass', status: 'available',
    description: 'Two mirrored glass-fronted homes under one crisp roof slab, separated by a stone fin wall.',
    features: ['Mirrored glass fronts', 'Stone party wall', 'Shared roof slab'], aliases: ['twin glass'] },
  { id: 'lm.duplex.asymmetric-concrete', collection: 'luxury-minimalist', buildingType: 'duplex', name: 'Asymmetric Concrete Duplex', nameVi: 'Nhà song lập Asymmetric Concrete', status: 'available',
    description: 'Two homes of different heights in light concrete, one with a cantilevered upper box.',
    features: ['Split heights', 'Cantilevered box', 'Concrete and walnut'], aliases: ['asymmetric concrete'] },
  { id: 'lm.duplex.courtyard', collection: 'luxury-minimalist', buildingType: 'duplex', name: 'Courtyard Duplex', nameVi: 'Nhà song lập Courtyard', status: 'available',
    description: 'Twin homes each opening onto a walled garden court through full-height glass.',
    features: ['Walled garden courts', 'Timber gates', 'Glass courtyard walls'], aliases: ['courtyard duplex'] },
  { id: 'lm.duplex.urban-terrace', collection: 'luxury-minimalist', buildingType: 'duplex', name: 'Urban Terrace Duplex', nameVi: 'Nhà song lập Urban Terrace', status: 'available',
    description: 'Stacked homes with planted roof terraces, slim fins and a charcoal frame.',
    features: ['Planted roof terraces', 'Charcoal frame', 'Vertical fins'], aliases: ['urban terrace'] },
  { id: 'lm.townhouse.vertical-minimalist', collection: 'luxury-minimalist', buildingType: 'townhouse', name: 'Vertical Minimalist Townhouse', nameVi: 'Nhà phố Vertical Minimalist', status: 'available',
    description: 'Tall ivory townhouses with deep framed windows stacked in a calm vertical rhythm.',
    features: ['Deep window frames', 'Vertical rhythm', 'Stone plinth'], aliases: ['vertical minimalist'] },
  { id: 'lm.townhouse.urban-glass', collection: 'luxury-minimalist', buildingType: 'townhouse', name: 'Urban Glass Townhouse', nameVi: 'Nhà phố Urban Glass', status: 'available',
    description: 'Glass-fronted townhouses with slim charcoal frames and bronze entrance canopies.',
    features: ['Glass fronts', 'Charcoal frames', 'Bronze canopies'], aliases: ['urban glass'] },
  { id: 'lm.townhouse.rooftop-terrace', collection: 'luxury-minimalist', buildingType: 'townhouse', name: 'Rooftop Terrace Townhouse', nameVi: 'Nhà phố Rooftop Terrace', status: 'available',
    description: 'Stepped townhouses with roof gardens, glass balustrades and pergolas on top.',
    features: ['Roof gardens', 'Glass balustrades', 'Pergolas'], aliases: ['rooftop terrace'] },
  { id: 'lm.townhouse.warm-timber', collection: 'luxury-minimalist', buildingType: 'townhouse', name: 'Warm Timber Townhouse', nameVi: 'Nhà phố Warm Timber', status: 'available',
    description: 'Walnut-clad townhouses with timber screens over the windows and planted window ledges.',
    features: ['Walnut cladding', 'Timber screens', 'Planted ledges'], aliases: ['warm timber'] },
  { id: 'lm.apartment.premium-glass', collection: 'luxury-minimalist', buildingType: 'apartment', name: 'Premium Glass Residence', nameVi: 'Chung cư Premium Glass', status: 'available',
    description: 'A glass residence with ivory floor slabs, wraparound balconies and a lit lobby.',
    features: ['Wraparound balconies', 'Ivory slab edges', 'Glass lobby'], aliases: ['premium glass'] },
  { id: 'lm.apartment.green-terrace', collection: 'luxury-minimalist', buildingType: 'apartment', name: 'Green Terrace Apartments', nameVi: 'Chung cư Green Terrace', status: 'available',
    description: 'Stepped terraces overflowing with planters, timber soffits and a garden podium.',
    features: ['Stepped green terraces', 'Timber soffits', 'Garden podium'], aliases: ['green terrace'] },
  { id: 'lm.apartment.residential-tower', collection: 'luxury-minimalist', buildingType: 'apartment', name: 'Minimalist Residential Tower', nameVi: 'Tháp Minimalist Residential', status: 'available',
    description: 'A slender ivory tower with recessed loggias and a bronze crown on a stone base.',
    features: ['Recessed loggias', 'Bronze crown', 'Stone base'], aliases: ['residential tower', 'minimalist tower'] },
  { id: 'lm.apartment.contemporary-courtyard', collection: 'luxury-minimalist', buildingType: 'apartment', name: 'Contemporary Courtyard Apartments', nameVi: 'Chung cư Contemporary Courtyard', status: 'available',
    description: 'A U-shaped block around a landscaped courtyard with a reflecting pool.',
    features: ['Landscaped courtyard', 'Reflecting pool', 'Walnut screens'], aliases: ['contemporary courtyard'] },
  { id: 'lm.office.architectural-concrete', collection: 'luxury-minimalist', buildingType: 'office', name: 'Architectural Concrete Office', nameVi: 'Văn phòng Architectural Concrete', status: 'available',
    description: 'Deep concrete frames over recessed glass, with a garden court at the entrance.',
    features: ['Deep concrete frames', 'Recessed glazing', 'Garden court'], aliases: ['architectural concrete', 'concrete office'] },
  { id: 'lm.mall.boutique-frontage', collection: 'luxury-minimalist', buildingType: 'mall', name: 'Boutique Retail Frontage', nameVi: 'Phố mua sắm Boutique', status: 'available',
    description: 'A row of tall glass boutiques with bronze frames and individual entrances along a stone arcade.',
    features: ['Glass boutiques', 'Bronze frames', 'Stone arcade'], aliases: ['boutique', 'boutique retail'] },
  { id: 'lm.clubhouse.glass-pavilion', collection: 'luxury-minimalist', buildingType: 'clubhouse', name: 'Minimalist Glass Pavilion', nameVi: 'Câu lạc bộ Glass Pavilion', status: 'available',
    description: 'A glass box under a thin roof plate beside a reflecting pool and lounge terrace.',
    features: ['Glass box', 'Reflecting pool', 'Lounge terrace'], aliases: ['glass pavilion clubhouse'] },
  { id: 'lm.pool.geometric', collection: 'luxury-minimalist', buildingType: 'pool', name: 'Luxury Geometric Pool', nameVi: 'Hồ bơi Luxury Geometric', status: 'available',
    description: 'Interlocking rectangular pools set in pale stone with cabanas and a sunken lounge.',
    features: ['Interlocking pools', 'Stone deck', 'Cabanas'], aliases: ['geometric pool'] },
  { id: 'lm.park.community-plaza', collection: 'luxury-minimalist', buildingType: 'park', name: 'Premium Community Plaza', nameVi: 'Quảng trường Premium', status: 'available',
    description: 'A paved plaza with a water table, sculpted lawns and a timber pergola.',
    features: ['Water table', 'Sculpted lawns', 'Timber pergola'], aliases: ['community plaza', 'plaza'] },

  // Modern Coastal.
  { id: 'mc.villa.shoreline', collection: 'modern-coastal', buildingType: 'villa', name: 'Shoreline Gable Villa', nameVi: 'Biệt thự Shoreline', status: 'available',
    description: 'White board-and-batten under a steep standing-seam gable, with a deep porch and timber deck.',
    features: ['Steep metal gable', 'Board-and-batten', 'Deep porch'], aliases: ['shoreline'] },
  { id: 'mc.clubhouse.leisure', collection: 'modern-coastal', buildingType: 'clubhouse', name: 'Contemporary Leisure Clubhouse', nameVi: 'Câu lạc bộ Leisure', status: 'available',
    description: 'A gabled boathouse-style clubhouse with a deck, deck chairs and sea-grass planting.',
    features: ['Gabled hall', 'Wraparound deck', 'Sea grasses'], aliases: ['leisure clubhouse'] },
  { id: 'mc.duplex.dune', collection: 'modern-coastal', buildingType: 'duplex', name: 'Dune Cottage Duplex', nameVi: 'Nhà song lập Dune', status: 'planned',
    description: 'Twin coastal cottages with metal gables and shared dune garden.', features: ['Metal gables', 'Dune garden'] },

  // Tropical Contemporary.
  { id: 'tc.villa.lanai', collection: 'tropical-contemporary', buildingType: 'villa', name: 'Lanai Pavilion Villa', nameVi: 'Biệt thự Lanai', status: 'available',
    description: 'A broad hipped shade roof over an open lanai, breeze-block screens and a palm courtyard.',
    features: ['Broad shade roof', 'Breeze-block screen', 'Open lanai'], aliases: ['lanai'] },
  { id: 'tc.mall.shopping-pavilion', collection: 'tropical-contemporary', buildingType: 'mall', name: 'Contemporary Shopping Pavilion', nameVi: 'Trung tâm Shopping Pavilion', status: 'available',
    description: 'Shops under a sweeping timber canopy around a planted courtyard.',
    features: ['Timber canopy', 'Planted courtyard', 'Open arcade'], aliases: ['shopping pavilion'] },
  { id: 'tc.office.rooftop-garden', collection: 'tropical-contemporary', buildingType: 'office', name: 'Rooftop Garden Office', nameVi: 'Văn phòng Rooftop Garden', status: 'available',
    description: 'Terraced office floors with planted edges, timber louvres and a roof garden.',
    features: ['Planted terraces', 'Timber louvres', 'Roof garden'], aliases: ['rooftop garden office', 'garden office'] },
  { id: 'tc.clubhouse.resort', collection: 'tropical-contemporary', buildingType: 'clubhouse', name: 'Tropical Resort Clubhouse', nameVi: 'Câu lạc bộ Tropical Resort', status: 'available',
    description: 'A tall thatched-look pavilion roof over an open bar, with a pool deck and palms.',
    features: ['Tall pavilion roof', 'Open bar', 'Palms'], aliases: ['resort clubhouse'] },
  { id: 'tc.pool.resort', collection: 'tropical-contemporary', buildingType: 'pool', name: 'Modern Resort Pool', nameVi: 'Hồ bơi Modern Resort', status: 'available',
    description: 'A free-form lagoon pool with a swim-up island, daybeds and palms.',
    features: ['Lagoon pool', 'Island', 'Daybeds'], aliases: ['resort pool'] },
  { id: 'tc.park.tropical-garden', collection: 'tropical-contemporary', buildingType: 'park', name: 'Tropical Garden Park', nameVi: 'Công viên Tropical Garden', status: 'available',
    description: 'Dense tropical planting, a boardwalk loop and a shaded pavilion over a pond.',
    features: ['Boardwalk loop', 'Tropical planting', 'Pond pavilion'], aliases: ['tropical garden'] },

  // Urban Premium.
  { id: 'up.office.glass', collection: 'urban-premium', buildingType: 'office', name: 'Modern Glass Office', nameVi: 'Văn phòng Modern Glass', status: 'available',
    description: 'A sleek curtain-wall office with rounded corners and a glowing lobby.',
    features: ['Curtain wall', 'Rounded corner', 'Glowing lobby'], aliases: ['glass office'] },
  { id: 'up.office.premium-tower', collection: 'urban-premium', buildingType: 'office', name: 'Premium Commercial Tower', nameVi: 'Tháp Premium Commercial', status: 'available',
    description: 'A tall tower with vertical bronze fins, setbacks and an illuminated crown.',
    features: ['Bronze fins', 'Setbacks', 'Illuminated crown'], aliases: ['premium tower', 'commercial tower'] },
  { id: 'up.mall.glass', collection: 'urban-premium', buildingType: 'mall', name: 'Premium Glass Mall', nameVi: 'Trung tâm Premium Glass', status: 'available',
    description: 'A glass mall with a cantilevered entrance canopy and a media wall.',
    features: ['Glass facade', 'Cantilevered canopy', 'Media wall'], aliases: ['glass mall'] },
  { id: 'up.park.urban', collection: 'urban-premium', buildingType: 'park', name: 'Modern Urban Park', nameVi: 'Công viên Modern Urban', status: 'available',
    description: 'Geometric lawns, a sunken amphitheatre and planted bosques in a paved grid.',
    features: ['Amphitheatre', 'Geometric lawns', 'Tree bosque'], aliases: ['urban park'] },
  { id: 'up.townhouse.skyline', collection: 'urban-premium', buildingType: 'townhouse', name: 'Skyline Townhouse', nameVi: 'Nhà phố Skyline', status: 'planned',
    description: 'Dark-framed glass townhouses with roof decks.', features: ['Dark frames', 'Roof decks'] },

  // Family Garden Homes.
  { id: 'fg.villa.garden-porch', collection: 'family-garden', buildingType: 'villa', name: 'Garden Porch Home', nameVi: 'Nhà vườn hiên rộng', status: 'available',
    description: 'A friendly gabled home with a wraparound porch, vegetable beds, a play lawn and a swing.',
    features: ['Wraparound porch', 'Vegetable beds', 'Play lawn'], aliases: ['garden porch'] },
  { id: 'fg.pool.community', collection: 'family-garden', buildingType: 'pool', name: 'Landscaped Community Pool', nameVi: 'Hồ bơi cộng đồng', status: 'available',
    description: 'A family pool with a splash pad, shaded lawn and picnic tables in a garden.',
    features: ['Splash pad', 'Shaded lawn', 'Picnic tables'], aliases: ['community pool'] },
  { id: 'fg.duplex.garden', collection: 'family-garden', buildingType: 'duplex', name: 'Twin Garden Cottages', nameVi: 'Nhà song lập vườn', status: 'planned',
    description: 'Twin cottages with porches and shared garden.', features: ['Porches', 'Shared garden'] },
];

const byId = new Map(ARCHITECTURE_MODELS.map((model) => [model.id, model]));
const collectionsById = new Map(ARCHITECTURE_COLLECTIONS.map((collection) => [collection.id, collection]));

export const architectureModel = (id: string): ArchitectureModel | undefined => byId.get(id);
export const architectureCollection = (id: string): ArchitectureCollection | undefined => collectionsById.get(id as ArchitectureCollectionId);
export const isCollectionId = (value: unknown): value is ArchitectureCollectionId => typeof value === 'string' && collectionsById.has(value as ArchitectureCollectionId);

/** Models of a building type (optionally one collection), in catalog order. Includes planned models unless `availableOnly`. */
export function modelsFor(buildingType: BuildingType, collection?: ArchitectureCollectionId, availableOnly = false): ArchitectureModel[] {
  return ARCHITECTURE_MODELS.filter((model) => model.buildingType === buildingType && (!collection || model.collection === collection) &&
    model.status !== 'retired' && (!availableOnly || model.status === 'available'));
}
/** Collections with at least one available model for a building type. */
export function collectionsFor(buildingType: BuildingType): ArchitectureCollection[] {
  return ARCHITECTURE_COLLECTIONS.filter((collection) => modelsFor(buildingType, collection.id, true).length > 0);
}

/** True when the design names an existing model of that building type in that collection (available or retired). */
export function isKnownDesign(buildingType: BuildingType, value: unknown): value is BuildingDesign {
  if (value === null || typeof value !== 'object') return false;
  const design = value as Record<string, unknown>;
  if (Object.keys(design).some((key) => key !== 'collection' && key !== 'model')) return false;
  const model = typeof design.model === 'string' ? byId.get(design.model) : undefined;
  return !!model && model.buildingType === buildingType && model.collection === design.collection && model.status !== 'planned';
}
/** True when a design can be chosen for new construction. */
export function isSelectableDesign(buildingType: BuildingType, value: unknown): value is BuildingDesign {
  return isKnownDesign(buildingType, value) && byId.get(value.model)!.status === 'available';
}

export const designOf = (model: ArchitectureModel): BuildingDesign => ({ collection: model.collection, model: model.id });

/**
 * Deterministic model within a collection for the n-th building of a request ("five Luxury Minimalist villas"
 * cycle through the collection's villas in catalog order, so neighbours differ).
 */
export function collectionModelAt(buildingType: BuildingType, collection: ArchitectureCollectionId, n: number): ArchitectureModel | undefined {
  const models = modelsFor(buildingType, collection, true);
  return models.length ? models[((n % models.length) + models.length) % models.length] : undefined;
}

/** Classic model for a 3.0B variant index. */
export function classicModel(buildingType: BuildingType, variant: number): ArchitectureModel | undefined {
  return ARCHITECTURE_MODELS.find((model) => model.collection === 'classic' && model.buildingType === buildingType && model.classicVariant === variant);
}

/** Request-side match of a phrase to a collection and/or model (longest alias wins). */
export interface ArchitectureMention { readonly collection: ArchitectureCollectionId | null; readonly model: ArchitectureModel | null; readonly phrase: string; readonly at: number }
export function findArchitectureMentions(text: string): ArchitectureMention[] {
  const lower = text.normalize('NFC').toLowerCase();
  const phrases: { phrase: string; collection: ArchitectureCollectionId | null; model: ArchitectureModel | null }[] = [];
  for (const model of ARCHITECTURE_MODELS) {
    if (model.status === 'retired') continue;
    for (const phrase of new Set([model.name.toLowerCase(), ...(model.aliases ?? [])])) phrases.push({ phrase, collection: model.collection, model });
  }
  for (const collection of ARCHITECTURE_COLLECTIONS) for (const phrase of [collection.name.toLowerCase(), ...collection.aliases]) phrases.push({ phrase, collection: collection.id, model: null });
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);
  const taken: [number, number][] = [];
  const mentions: ArchitectureMention[] = [];
  for (const entry of phrases) {
    let at = lower.indexOf(entry.phrase);
    while (at >= 0) {
      const end = at + entry.phrase.length;
      const bounded = (at === 0 || !/\p{L}/u.test(lower[at - 1]!)) && (end >= lower.length || !/\p{L}/u.test(lower[end]!));
      if (bounded && !taken.some(([a, b]) => at < b && end > a)) { taken.push([at, end]); mentions.push({ ...entry, at }); }
      at = lower.indexOf(entry.phrase, at + 1);
    }
  }
  return mentions.sort((a, b) => a.at - b.at);
}
