import XCTest
@testable import PoleLine

final class OfflineTests: XCTestCase {
    func testFictionalCatalogAndTyres() throws {
        let catalog: [CircuitSummary] = try decode(PLCore.catalog())
        XCTAssertEqual(catalog.count,25)
        for item in catalog {
            let circuit: Circuit = try decode(PLCore.circuit(item.index))
            for tyre in 0..<3 {
                let coordinates = circuit.points.flatMap{$0}.map{NSNumber(value:$0)}
                let lap: Lap = try decode(PLCore.race(item.index,coordinates:coordinates,tyre:tyre))
                XCTAssertTrue(lap.valid);XCTAssertGreaterThan(lap.timeMs,10000)
                XCTAssertEqual(lap.sectors.reduce(0,+),lap.timeMs)
                XCTAssertTrue(zip(lap.time,lap.time.dropFirst()).allSatisfy{$0.0 < $0.1})
            }
        }
    }
    func testDrawingUndoAndPersistence() throws {
        let circuit: Circuit = try decode(PLCore.circuit(0))
        _ = PLCore.touch(0,x:circuit.points[0][0],y:circuit.points[0][1])
        for p in circuit.points.dropFirst() { _ = PLCore.touch(1,x:p[0],y:p[1]) }
        let drawing: Drawing = try decode(PLCore.touch(1,x:circuit.points[0][0],y:circuit.points[0][1]))
        XCTAssertTrue(drawing.done)
        let lap: Lap = try decode(PLCore.race(0,coordinates:drawing.points.flatMap{$0}.map{NSNumber(value:$0)},tyre:1))
        let suite = "poleline-tests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName:suite));defer { defaults.removePersistentDomain(forName:suite) }
        let records = Records(defaults:defaults)
        XCTAssertTrue(records.save(circuit.id,lap:lap,line:drawing.points))
        XCTAssertEqual(Records(defaults:defaults).best(circuit.id)?.timeMs,lap.timeMs)
        let undone: Drawing = try decode(PLCore.touch(3,x:0,y:0));XCTAssertTrue(undone.points.isEmpty)
    }
    func testMalformedLocalRecordIsIgnored() {
        let suite = "poleline-malformed-\(UUID().uuidString)";let defaults = UserDefaults(suiteName:suite)!
        defer { defaults.removePersistentDomain(forName:suite) }
        defaults.set(Data("{broken".utf8),forKey:"poleline:best:pocket-park")
        XCTAssertNil(Records(defaults:defaults).best("pocket-park"))
    }
}
