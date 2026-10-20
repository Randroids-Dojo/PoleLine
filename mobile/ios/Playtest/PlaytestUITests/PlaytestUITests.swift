import XCTest

/// Drives the installed app through its first screens with real touches.
final class PlaytestUITests: XCTestCase {
    private let outDir = "/tmp/poleline-ios"

    override func setUpWithError() throws {
        continueAfterFailure = false
        try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
    }

    private func save(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let path = "\(outDir)/\(name).png"
        do {
            try png.write(to: URL(fileURLWithPath: path))
            print("screenshot \(path)")
        } catch {
            let attachment = XCTAttachment(uniformTypeIdentifier: "public.png", name: "\(name).png", payload: png, userInfo: nil)
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    func testFirstScreensAndAStroke() throws {
        let app = XCUIApplication(bundleIdentifier: "app.toyboxes.poleline")
        app.launch()

        // First launch opens the guided lap; later launches open the circuits.
        let skip = app.buttons["Skip tutorial"]
        if skip.waitForExistence(timeout: 20) {
            save("0-welcome")
            skip.tap()
        }
        let draw = app.buttons["Draw a lap"]
        XCTAssertTrue(draw.waitForExistence(timeout: 20), "home screen")
        sleep(1)
        save("1-home")

        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Start over"].waitForExistence(timeout: 5), "settings sheet with the About group")
        XCTAssertFalse(app.staticTexts["Lap alerts"].exists, "no lap alerts in the app edition")
        save("2-settings")
        app.buttons["Close settings"].tap()

        draw.tap()
        XCTAssertTrue(app.staticTexts["Draw your lap"].waitForExistence(timeout: 20), "draw screen")
        sleep(2)
        save("3-draw")

        // The start line sits about 62 percent down the screen with the road ahead pointing up.
        let window = app.windows.firstMatch
        let from = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.62))
        let to = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        sleep(1)
        save("4-stroke")
        let progressed = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^[1-9][0-9]?%$")).firstMatch
        XCTAssertTrue(progressed.waitForExistence(timeout: 5), "a stroke moved the lap progress off zero")
        print("progress \(progressed.label)")
    }
}
