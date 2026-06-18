import React from 'react';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  isOnline?: boolean;
  showStatus?: boolean;
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 40,
  isOnline = false,
  showStatus = false,
}) => {
  // Get initials (up to 2 characters)
  const getInitials = (nameStr: string) => {
    if (!nameStr) return '?';
    const parts = nameStr.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return nameStr.substring(0, Math.min(nameStr.length, 2)).toUpperCase();
  };

  // Generate a consistent gradient background based on the name hash
  const getGradientColor = (nameStr: string) => {
    let hash = 0;
    for (let i = 0; i < nameStr.length; i++) {
      hash = nameStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const colors = [
      ['#ff5f6d', '#ffc371'], // Coral Red
      ['#2193b0', '#6dd5ed'], // Blue Lagoon
      ['#ee0979', '#ff6a00'], // Sunset Pink
      ['#11998e', '#38ef7d'], // Emerald
      ['#7f00ff', '#e100ff'], // Violet Glow
      ['#ff416c', '#ff4b2b'], // Crimson
      ['#8a2387', '#e94057'], // Plum Orange
      ['#00c6ff', '#0072ff'], // Electric Blue
    ];
    
    const index = Math.abs(hash) % colors.length;
    return `linear-gradient(135deg, ${colors[index][0]}, ${colors[index][1]})`;
  };

  const initials = getInitials(name);
  const background = getGradientColor(name);

  return (
    <div 
      className="user-avatar-container" 
      style={{ width: size, height: size }}
    >
      {src ? (
        <img 
          src={src} 
          alt={name} 
          className="user-avatar" 
          onError={(e) => {
            // Fallback if image fails to load
            (e.target as HTMLImageElement).style.display = 'none';
            const parent = (e.target as HTMLElement).parentElement;
            if (parent) {
              const fallback = parent.querySelector('.avatar-fallback') as HTMLElement;
              if (fallback) fallback.style.display = 'flex';
            }
          }}
        />
      ) : null}
      
      <div 
        className="user-avatar avatar-fallback" 
        style={{ 
          display: src ? 'none' : 'flex',
          background,
          color: '#ffffff',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: size * 0.4,
          height: '100%',
          width: '100%',
          borderRadius: '50%'
        }}
      >
        {initials}
      </div>

      {showStatus && (
        <div className={isOnline ? 'online-dot' : 'offline-dot'} />
      )}
    </div>
  );
};
