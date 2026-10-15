import { Icon } from './Icon';

/**
 * Every camera control in one place (Phase 4.6): zoom and the neighbourhood framing for all modes, plus, in Life
 * Mode, the City View / Life View switch, Focus and Follow. The Follow state shown is the real one the camera uses.
 */
export function CameraControls({ lifeActive, playerName, playerPlaced, cameraView, following, onZoom, onHome, onFocus, onToggleFollow, onView }: {
  lifeActive: boolean;
  playerName: string | null;
  /** The character is in the world (created and moved in). */
  playerPlaced: boolean;
  cameraView: 'city' | 'life';
  following: boolean;
  onZoom: (factor: number) => void;
  onHome: () => void;
  onFocus: () => void;
  onToggleFollow: () => void;
  onView: (view: 'city' | 'life') => void;
}) {
  const absent = !playerName ? 'Create a character first' : `${playerName} has not moved in yet`;
  return <>
    {lifeActive && <div className="life-camera" role="group" aria-label="Character camera">
      <div className="view-switch" role="group" aria-label="Camera view">
        <button type="button" aria-pressed={cameraView === 'life'} disabled={!playerPlaced} onClick={() => onView('life')}
          title={playerPlaced ? 'Close-up that follows your character' : absent}><Icon name="person" size={14} /><span>Life view</span></button>
        <button type="button" aria-pressed={cameraView === 'city'} onClick={() => onView('city')} title="Overview of the neighborhood">
          <Icon name="layers" size={14} /><span>City view</span></button>
      </div>
      <button type="button" className="camera-chip" aria-label="Focus on your character" disabled={!playerPlaced} onClick={onFocus}
        title={playerPlaced ? 'Glide to your character' : absent}><Icon name="target" size={15} /><span>Focus</span></button>
      <button type="button" className={`camera-chip ${following ? 'is-on' : ''}`} aria-label="Follow your character" aria-pressed={following}
        disabled={!playerPlaced} onClick={onToggleFollow} title={!playerPlaced ? absent : following ? 'Following · drag the map or press to stop' : 'Keep your character in view'}>
        <Icon name="follow" size={15} /><span>{following ? 'Following' : 'Follow'}</span></button>
    </div>}
    <div className="zoom-controls" role="group" aria-label="Camera">
      <button className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => onZoom(1.25)}><Icon name="plus" size={16} /></button>
      <button className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => onZoom(0.8)}><Icon name="minus" size={16} /></button>
      <button className="icon-button camera-home" aria-label="Center neighborhood" title="Return to the built neighborhood" onClick={onHome}><Icon name="center" size={16} /></button>
    </div>
  </>;
}
