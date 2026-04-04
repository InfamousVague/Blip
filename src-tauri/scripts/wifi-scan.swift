#!/usr/bin/env swift
// WiFi scanner using CoreWLAN — outputs JSON array of networks
import CoreWLAN
import CoreLocation
import Foundation

// Request location authorization — required for SSID/BSSID access on macOS 14+
class LocationDelegate: NSObject, CLLocationManagerDelegate {
    let semaphore = DispatchSemaphore(value: 0)
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        semaphore.signal()
    }
}

let locManager = CLLocationManager()
let locDelegate = LocationDelegate()
locManager.delegate = locDelegate
if CLLocationManager.authorizationStatus() == .notDetermined {
    locManager.requestWhenInUseAuthorization()
    _ = locDelegate.semaphore.wait(timeout: .now() + 5)
}

struct Network: Codable {
    let ssid: String
    let bssid: String
    let signal_dbm: Int
    let channel: Int
    let frequency_mhz: Int
    let channel_width: Int
    let security: String
    let band: String
    let noise_dbm: Int?
    let is_current: Bool
}

let client = CWWiFiClient.shared()
guard let iface = client.interface() else {
    print("[]")
    exit(0)
}

let currentBSSID = iface.bssid()
var networks: [Network] = []

do {
    let scanResults = try iface.scanForNetworks(withName: nil)
    for net in scanResults {
        let ch = net.wlanChannel
        let channelNum = ch?.channelNumber ?? 0
        let width: Int
        switch ch?.channelWidth {
        case .width20MHz: width = 20
        case .width40MHz: width = 40
        case .width80MHz: width = 80
        case .width160MHz: width = 160
        default: width = 20
        }

        let freqMhz: Int
        if channelNum <= 14 {
            freqMhz = channelNum == 14 ? 2484 : 2407 + channelNum * 5
        } else {
            freqMhz = 5000 + channelNum * 5
        }

        let band = channelNum <= 14 ? "2.4GHz" : "5GHz"

        let security: String
        if net.supportsSecurity(.wpa3Personal) || net.supportsSecurity(.wpa3Enterprise) {
            security = "WPA3"
        } else if net.supportsSecurity(.wpa2Personal) || net.supportsSecurity(.wpa2Enterprise) {
            security = "WPA2"
        } else if net.supportsSecurity(.wpaPersonal) || net.supportsSecurity(.wpaEnterprise) {
            security = "WPA"
        } else if net.supportsSecurity(.dynamicWEP) {
            security = "WEP"
        } else {
            security = "Open"
        }

        networks.append(Network(
            ssid: net.ssid ?? "",
            bssid: net.bssid ?? "",
            signal_dbm: net.rssiValue,
            channel: channelNum,
            frequency_mhz: freqMhz,
            channel_width: width,
            security: security,
            band: band,
            noise_dbm: net.noiseMeasurement,
            is_current: net.bssid == currentBSSID
        ))
    }
} catch {
    // Scan failed — output empty array
}

let encoder = JSONEncoder()
if let data = try? encoder.encode(networks), let json = String(data: data, encoding: .utf8) {
    print(json)
} else {
    print("[]")
}
