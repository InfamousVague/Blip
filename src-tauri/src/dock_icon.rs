#[cfg(target_os = "macos")]
pub fn set_dock_icon(png_data: &[u8]) {
    use cocoa::appkit::NSApp;
    use cocoa::base::{id, nil};
    use objc::{msg_send, sel, sel_impl, class};

    unsafe {
        let app: id = NSApp();
        let ns_data: id = msg_send![class!(NSData), dataWithBytes:png_data.as_ptr() length:png_data.len()];
        let ns_image: id = msg_send![class!(NSImage), alloc];
        let ns_image: id = msg_send![ns_image, initWithData:ns_data];
        if ns_image != nil {
            let _: () = msg_send![app, setApplicationIconImage:ns_image];
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_dock_icon(_png_data: &[u8]) {
    // No-op on non-macOS platforms
}
