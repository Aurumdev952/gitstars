// Keeps a release build on Windows from opening a console window next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gitstars_lib::run()
}
