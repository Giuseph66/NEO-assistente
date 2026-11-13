import React from 'react';
import { ProviderIcon, ProviderIconProps } from './ProviderIcon';

/** Generic burst glyph in Claude's accent color (not the trademark logo). */
export const ClaudeIcon: React.FC<ProviderIconProps> = (props) => {
    return (
        <ProviderIcon {...props} viewBox="0 0 24 24">
            <g stroke="#D97757" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="3" x2="12" y2="21" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
                <line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
            </g>
        </ProviderIcon>
    );
};
