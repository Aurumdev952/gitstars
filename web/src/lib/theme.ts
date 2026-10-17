// Scene tokens. DOM tokens live in styles/app.css; these feed shaders and post-processing.
export const sceneTheme = {
  backdrop: {
    zenith: [0.012, 0.011, 0.03] as const,
    horizon: [0.0035, 0.0035, 0.009] as const,
    band: [0.05, 0.034, 0.085] as const,
    bandWarm: [0.075, 0.045, 0.03] as const,
  },
  fog: { near: 220, far: 900, color: [0.012, 0.012, 0.03] as const },
  stars: { sizeScale: 1.9, minPx: 2.6, maxPx: 56 },
  // Threshold sits above label and halo luminance so only HDR star cores bloom.
  bloom: { threshold: 0.9, smoothing: 0.2, intensity: 1.1, radius: 0.72, levels: 7 },
  vignette: { offset: 0.3, darkness: 0.7 },
  noise: 0.025,
  label: { outline: '#05050d', macroPx: 14 },
} as const
