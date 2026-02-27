# Sample code

## Overview

The code shows a component of a personal project that I'm working on. The project is to build an app, SpatialViewer, that allows users to analyze and more importantly, view spatial transcriptomics data with ease. The component shown here deals with tiled-based system, which is used to better handle memory and speed when loading high res images and high dimensional data (100k+ cells and 15k+ genes). The idea is to pre-generate 256x256 pixel tiles at multiple zoom levels, then serve only the tiles visible in the current viewport.

The files show the Python subprocess, its bridge to Rust, the frontend API endpoints, and the React+TypeScript viewer component.


## Files

- `python_tiling.py` - Python subprocess
- `rust_bridge.rs` - Rust bridge
- `react_viewer.tsx` - Frontend tile viewer
- `api.ts` - API endpoints for frontend
