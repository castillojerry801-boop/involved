import Capacitor

class ViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView?.isInspectable = true
        }
        #endif
    }
}
