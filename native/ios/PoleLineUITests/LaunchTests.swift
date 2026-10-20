import XCTest
final class LaunchTests: XCTestCase {
    func testFirstLaunchAndNativeCircuit() {
        let app = XCUIApplication();app.launch()
        XCTAssertTrue(app.buttons["circuit-0"].waitForExistence(timeout:10))
        app.buttons["circuit-0"].tap()
        XCTAssertTrue(app.otherElements["circuitCanvas"].waitForExistence(timeout:15))
        XCTAssertTrue(app.buttons["raceLine"].exists)
        XCTAssertFalse(app.buttons["raceLine"].isEnabled)
        app.screenshot().pngRepresentation.writeAttachment(name:"native-ios-first-circuit",test:self)
    }
}
private extension Data {
    func writeAttachment(name: String,test: XCTestCase) {
        let attachment = XCTAttachment(data:self,uniformTypeIdentifier:"public.png");attachment.name = name;attachment.lifetime = .keepAlways
        test.add(attachment)
    }
}
