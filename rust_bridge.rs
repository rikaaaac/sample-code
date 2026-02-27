use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::State;

// ===== python Bridge Core =====

#[derive(Debug, Serialize, Deserialize)]
struct PythonRequest {
    command: String,
    params: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct PythonResponse {
    success: bool,
    data: Option<serde_json::Value>,
    error: Option<String>,
}

pub struct PythonBridge {
    /// python child process
    process: Child,
    /// sending commands to python, wrapped in arc for thread-safe sharing
    stdin: Arc<Mutex<ChildStdin>>,
    /// reading responses from python
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
}

impl PythonBridge {
    /// core communication method
    ///
    /// sends JSON request to Python, waits for JSON response, parses result
    /// this is synchronous and blocking, the calling thread will wait until
    /// Python processes the command and returns
    fn send_command(
        &self,
        command: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let request = PythonRequest {
            command: command.to_string(),
            params,
        };

        let request_json = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        println!("PythonBridge: Sending JSON: {}", request_json);

        // send command - write JSON to python via stdin
        {
            let mut stdin = self.stdin.lock().unwrap();
            writeln!(stdin, "{}", request_json).map_err(|e| {
                println!("PythonBridge: Error writing to stdin: {}", e);
                e.to_string()
            })?;
            stdin.flush().map_err(|e| {
                println!("PythonBridge: Error flushing stdin: {}", e);
                e.to_string()
            })?;
        }
        println!("PythonBridge: Sent command, waiting for response...");

        // read response from python via stdout
        let mut stdout = self.stdout.lock().unwrap();
        let mut response_line = String::new();
        stdout
            .read_line(&mut response_line)
            .map_err(|e| {
                println!("PythonBridge: Error reading from stdout: {}", e);
                e.to_string()
            })?;

        println!("PythonBridge: Got response line: {}", response_line);

        // parse the JSON response to PythonResponse
        let response: PythonResponse =
            serde_json::from_str(&response_line).map_err(|e| {
                println!("PythonBridge: Error parsing JSON: {}", e);
                println!("PythonBridge: Raw response was: '{}'", response_line);
                format!("Failed to parse Python response: {}. Raw output: '{}'", e, response_line)
            })?;

        if response.success {
            Ok(response.data.unwrap_or(serde_json::Value::Null))
        } else {
            Err(response.error.unwrap_or_else(|| "Unknown error".to_string()))
        }
    }

    pub fn plot_tissue_overlay(
        &mut self,
        dataset_id: &str,
        img_id: &str,
        seg_id: &str,
        fill_key: &str,
        border_key: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        println!("PythonBridge: plot_tissue_overlay called with dataset_id: {}, fill_key: {}", dataset_id, fill_key);
        let params = serde_json::json!({
            "dataset_id": dataset_id,
            "img_id": img_id,
            "seg_id": seg_id,
            "fill_key": fill_key,
            "border_key": border_key
        });
        println!("PythonBridge: Sending command to Python...");
        let result = self.send_command("plot_tissue_overlay", params)?;
        println!("PythonBridge: Got response from Python: {:?}", result);
        Ok(result)
    }

    pub fn get_tissue_overlay_tile(
        &mut self,
        overlay_id: &str,
        zoom: i32,
        x: i32,
        y: i32,
    ) -> Result<serde_json::Value, String> {
        let params = serde_json::json!({
            "overlay_id": overlay_id,
            "zoom": zoom,
            "x": x,
            "y": y
        });
        self.send_command("get_tissue_overlay_tile", params)
    }
}

// ===== Tauri Commands =====

// global state for Python bridge
pub struct AppState {
    pub python: Mutex<Option<PythonBridge>>,
}

/// tauri command to generate tissue overlay and tiles
#[tauri::command]
pub async fn plot_tissue_overlay_cmd(
    dataset_id: String,
    img_id: String,
    seg_id: String,
    fill_key: String,
    border_key: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mut python = state.python.lock().unwrap();

    if python.is_none() {
        *python = Some(PythonBridge::new().map_err(|e| e.to_string())?);
    }

    if let Some(ref mut bridge) = *python {
        bridge.plot_tissue_overlay(
            &dataset_id,
            &img_id,
            &seg_id,
            &fill_key,
            border_key.as_deref(),
        )
    } else {
        Err("Failed to initialize Python bridge".to_string())
    }
}

/// tauri command to get a specific tile
/// this is called frequently as the user pans/zooms
#[tauri::command]
pub async fn get_tissue_overlay_tile_cmd(
    overlay_id: String,
    zoom: i32,
    x: i32,
    y: i32,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mut python = state.python.lock().unwrap();

    if python.is_none() {
        *python = Some(PythonBridge::new().map_err(|e| e.to_string())?);
    }

    if let Some(ref mut bridge) = *python {
        bridge.get_tissue_overlay_tile(&overlay_id, zoom, x, y)
    } else {
        Err("Failed to initialize Python bridge".to_string())
    }
}
