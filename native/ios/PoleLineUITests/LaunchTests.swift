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
    func testTouchDrawRacePauseReplayAndPersistence() throws {
        let app = XCUIApplication();app.launch()
        XCTAssertTrue(app.buttons["circuit-0"].waitForExistence(timeout:10))
        app.buttons["Settings"].tap()
        app.buttons["Delete all local records"].tap()
        app.buttons["Delete records"].tap()
        XCTAssertTrue(app.buttons["circuit-0"].waitForExistence(timeout:10))
        app.buttons["circuit-0"].tap()
        let canvas = app.otherElements["circuitCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout:15))
        let url = try XCTUnwrap(Bundle(for:Self.self).url(forResource:"circuits",withExtension:"json"))
        let circuits = try XCTUnwrap(JSONSerialization.jsonObject(with:Data(contentsOf:url)) as? [[String:Any]])
        let circuit = circuits[0],points = try XCTUnwrap(circuit["points"] as? [[Double]])
        let width = try XCTUnwrap(circuit["width"] as? Double)
        let xs = points.map{$0[0]},ys = points.map{$0[1]},frame = canvas.frame
        let x0 = try XCTUnwrap(xs.min()),x1 = try XCTUnwrap(xs.max()),y0 = try XCTUnwrap(ys.min()),y1 = try XCTUnwrap(ys.max())
        let scale = min((frame.width-24)/(x1-x0+width*2),(frame.height-32)/(y1-y0+width*2))
        func coordinate(_ p: [Double]) -> XCUICoordinate {
            canvas.coordinate(withNormalizedOffset:CGVector(dx:0.5+(p[0]-(x0+x1)/2)*scale/frame.width,dy:0.5+(p[1]-(y0+y1)/2)*scale/frame.height))
        }
        for i in stride(from:0,to:points.count,by:8) {
            coordinate(points[i]).press(forDuration:0.05,thenDragTo:coordinate(points[(i+8)%points.count]),withVelocity:.slow,thenHoldForDuration:0)
        }
        let race = app.buttons["raceLine"]
        XCTAssertTrue(race.isEnabled,"A lap drawn with real native touch input must be raceable")
        app.screenshot().pngRepresentation.writeAttachment(name:"native-ios-drawn-lap",test:self)
        race.tap()
        let pause = app.buttons["pauseLap"];XCTAssertTrue(pause.waitForExistence(timeout:15))
        pause.tap();XCTAssertEqual(pause.label,"Resume");pause.tap()
        app.screenshot().pngRepresentation.writeAttachment(name:"native-ios-racing",test:self)
        app.buttons["Finish lap"].tap()
        XCTAssertTrue(app.staticTexts["resultTime"].waitForExistence(timeout:5))
        let result = app.staticTexts["resultTime"].label
        XCTAssertTrue(app.staticTexts["New personal best. Saved on this device."].exists)
        app.screenshot().pngRepresentation.writeAttachment(name:"native-ios-results",test:self)
        app.buttons["Replay"].tap();XCTAssertTrue(app.buttons["pauseLap"].waitForExistence(timeout:5))
        app.buttons["Finish lap"].tap()
        XCTAssertTrue(app.staticTexts["New personal best. Saved on this device."].waitForExistence(timeout:5))
        app.buttons["Replay"].tap();XCTAssertTrue(app.buttons["pauseLap"].waitForExistence(timeout:5))
        app.terminate();app.launch()
        XCTAssertTrue(app.staticTexts["Best \(result)"].waitForExistence(timeout:5))
    }
}
private extension Data {
    func writeAttachment(name: String,test: XCTestCase) {
        let attachment = XCTAttachment(data:self,uniformTypeIdentifier:"public.png");attachment.name = name;attachment.lifetime = .keepAlways
        test.add(attachment)
    }
}
