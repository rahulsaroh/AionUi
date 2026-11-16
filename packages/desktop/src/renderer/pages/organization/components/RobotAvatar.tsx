/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface RobotAvatarProps {
  name?: string;
  icon?: string;
  size?: number;
  accentColor?: string;
  isWorking?: boolean;
  className?: string;
}

export const RobotAvatar: React.FC<RobotAvatarProps> = ({
  name = 'Agent',
  icon,
  size = 32,
  accentColor = '#38BDF8',
  isWorking = false,
  className = '',
}) => {
  // If a valid custom image URL or data URI is provided
  if (icon && (icon.startsWith('http') || icon.startsWith('data:') || icon.startsWith('/'))) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`relative shrink-0 rounded-full overflow-hidden bg-slate-800 ${className}`}
      >
        <img src={icon} alt={name} className='size-full object-cover' />
      </div>
    );
  }

  // Vector Robot Avatar with customizable accent colors
  return (
    <div
      style={{
        width: size,
        height: size,
      }}
      className={`relative shrink-0 flex items-center justify-center select-none ${className}`}
      title={name}
    >
      <svg
        viewBox='0 0 40 40'
        width={size}
        height={size}
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        className='overflow-visible'
      >
        {/* Soft background aura */}
        <circle cx='20' cy='20' r='18' fill='#0F172A' stroke={accentColor} strokeWidth='1.5' strokeOpacity='0.4' />

        {/* Top Antenna */}
        <line x1='20' y1='6' x2='20' y2='11' stroke={accentColor} strokeWidth='2' strokeLinecap='round' />
        <circle
          cx='20'
          cy='5'
          r='2.5'
          fill={accentColor}
          className={isWorking ? 'animate-ping origin-center' : undefined}
        />
        <circle cx='20' cy='5' r='2' fill='#FFFFFF' opacity='0.8' />

        {/* Ear Antennas / Audio Nodes */}
        <rect x='7' y='18' width='2.5' height='7' rx='1' fill={accentColor} opacity='0.8' />
        <rect x='30.5' y='18' width='2.5' height='7' rx='1' fill={accentColor} opacity='0.8' />

        {/* Robot Head Outer Box */}
        <rect x='10' y='12' width='20' height='18' rx='4' fill='#1E293B' stroke={accentColor} strokeWidth='1.5' />

        {/* Visor Area */}
        <rect
          x='13'
          y='16'
          width='14'
          height='6'
          rx='2.5'
          fill='#0B1120'
          stroke={accentColor}
          strokeWidth='0.8'
          strokeOpacity='0.6'
        />

        {/* Expressive Glowing Eyes */}
        <circle cx='16.5' cy='19' r='1.8' fill={accentColor}>
          {isWorking && <animate attributeName='opacity' values='1;0.4;1' dur='1.2s' repeatCount='indefinite' />}
        </circle>
        <circle cx='23.5' cy='19' r='1.8' fill={accentColor}>
          {isWorking && <animate attributeName='opacity' values='1;0.4;1' dur='1.2s' repeatCount='indefinite' />}
        </circle>

        {/* Mouth Grille */}
        <line
          x1='15'
          y1='26'
          x2='17'
          y2='26'
          stroke={accentColor}
          strokeWidth='1'
          strokeLinecap='round'
          opacity='0.7'
        />
        <line
          x1='19'
          y1='26'
          x2='21'
          y2='26'
          stroke={accentColor}
          strokeWidth='1'
          strokeLinecap='round'
          opacity='0.7'
        />
        <line
          x1='23'
          y1='26'
          x2='25'
          y2='26'
          stroke={accentColor}
          strokeWidth='1'
          strokeLinecap='round'
          opacity='0.7'
        />
      </svg>
    </div>
  );
};

export default React.memo(RobotAvatar);
