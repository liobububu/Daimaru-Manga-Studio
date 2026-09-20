/**
 * Video Player Component
 *
 * Video player based on video-react wrapper, supports custom poster, autoplay, mute and other features
 *
 * Usage example:
 * <Video
 *   src="" // Video resource URL, defaults to empty string
 *   poster="/poster.jpg" // Video poster image，可留空
 * />
 */

import {
    Player,
    BigPlayButton,
    ControlBar,
    PlayToggle,
    CurrentTimeDisplay,
    TimeDivider,
    DurationDisplay,
    FullscreenToggle,
    VolumeMenuButton,
    ProgressControl
} from 'video-react';
import 'video-react/dist/video-react.css';
import './video.css';
import { cn } from '@/lib/utils';
import type { FC } from 'react';

// @types/video-react 把 FullscreenToggle 的 actions 标成必填，但 actions / player
// 实际由 Player 渲染子节点时注入。这里只放宽类型、不额外传 props，
// 避免用空对象覆盖掉运行期注入的真实 actions。
const FullscreenToggleControl = FullscreenToggle as unknown as FC<{ key?: string }>;

interface VideoProps {
    /** Video resource URL */
    src: string;
    /** Video poster image URL */
    poster?: string;
    /** Custom class name */
    className?: string;
    /** Whether to autoplay, defaults to false */
    autoPlay?: boolean;
    /** Whether to mute, defaults to false */
    muted?: boolean;
    /** Whether to show controls, defaults to true */
    controls?: boolean;
    /** Video aspect ratio, defaults to 'auto' */
    aspectRatio?: 'auto' | '16:9' | '4:3' | (string & {});
}

export default function Video({
    className,
    src,
    poster,
    autoPlay = false,
    muted = false,
    controls = true,
    aspectRatio = 'auto'
}: VideoProps) {
    return (
        <div className={cn('min-w-[100px]', className)} custom-component="video">
            <Player
                poster={poster}
                src={src}
                autoPlay={autoPlay}
                muted={muted}
                aspectRatio={aspectRatio}
            >
                <ControlBar
                    disableDefaultControls
                    autoHide
                    disableCompletely={!controls}
                >
                    <PlayToggle key="play-toggle" />
                    <VolumeMenuButton key="volume-menu-button" vertical />
                    <CurrentTimeDisplay key="current-time-display" />
                    <TimeDivider key="time-divider" />
                    <DurationDisplay key="duration-display" />
                    <ProgressControl key="progress-control" />
                    <FullscreenToggleControl key="fullscreen-toggle" />
                </ControlBar>
                <BigPlayButton position="center" />
            </Player>
        </div>
    );
}
