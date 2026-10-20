import Foundation

func decode<T: Decodable>(_ value: String, as: T.Type = T.self) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(value.utf8))
}
func lapTime(_ ms: Int) -> String { String(format: "%d:%02d.%03d", ms / 60000, ms / 1000 % 60, ms % 1000) }
struct CircuitSummary: Decodable, Identifiable {
    let index: Int, id: String, name: String, region: String, character: String
    let length: Double
    let night: Bool
}
struct Circuit: Decodable {
    let index: Int, id: String, name: String, character: String, region: String
    let width: Double, length: Double
    let temperature: Int, air: Int
    let night: Bool
    let points: [[Double]]
    let gold: Int, silver: Int, bronze: Int
    func medal(_ ms: Int) -> String { ms <= gold ? "Gold" : ms <= silver ? "Silver" : ms <= bronze ? "Bronze" : "Lap complete" }
}
struct Drawing: Decodable {
    let done: Bool, active: Bool, progress: Double, message: String
    let points: [[Double]]
}
struct Lap: Decodable {
    let valid: Bool, version: Int, tyre: Int, timeMs: Int
    let sectors: [Int], topSpeed: Double, distance: Double
    let points: [[Double]], speed: [Double], time: [Double], progress: [Double], battery: [Double], temperature: [Double]
    func sample(_ seconds: Double) -> (point: [Double], index: Int) {
        var lo = 0, hi = points.count - 1
        while lo < hi { let mid = (lo + hi + 1) / 2; if time[mid] <= seconds { lo = mid } else { hi = mid - 1 } }
        let next = (lo + 1) % points.count
        let f = min(1, max(0, (seconds - time[lo]) / (time[lo+1] - time[lo])))
        return ([points[lo][0] + (points[next][0] - points[lo][0]) * f, points[lo][1] + (points[next][1] - points[lo][1]) * f], lo)
    }
}
struct Record: Codable {
    let version: Int, timeMs: Int, tyre: Int
    let line: [[Double]], sectors: [Int]
}
final class Records {
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    func best(_ id: String) -> Record? {
        guard let data = defaults.data(forKey: "poleline:best:\(id)"), let record = try? JSONDecoder().decode(Record.self,from: data), record.version == 1,
              record.timeMs > 0, (0...2).contains(record.tyre), (12...12000).contains(record.line.count), record.line.allSatisfy({ $0.count == 2 && $0.allSatisfy(\.isFinite) }) else { return nil }
        return record
    }
    @discardableResult func save(_ id: String, lap: Lap, line: [[Double]]) -> Bool {
        if let current = best(id), current.timeMs <= lap.timeMs { return false }
        let record = Record(version: 1,timeMs: lap.timeMs,tyre: lap.tyre,line: line,sectors: lap.sectors)
        guard let data = try? JSONEncoder().encode(record) else { return false }
        defaults.set(data,forKey: "poleline:best:\(id)");return true
    }
    var team: Int { get { min(5,max(0,defaults.integer(forKey: "poleline:team"))) } set { defaults.set(newValue,forKey: "poleline:team") } }
    var sound: Bool { get { defaults.object(forKey: "poleline:sound") as? Bool ?? true } set { defaults.set(newValue,forKey: "poleline:sound") } }
    func tyre(_ id: String) -> Int { min(2,max(0,defaults.integer(forKey: "poleline:tyre:\(id)"))) }
    func setTyre(_ id: String, _ tyre: Int) { defaults.set(tyre,forKey: "poleline:tyre:\(id)") }
    func clear() { for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("poleline:") { defaults.removeObject(forKey: key) } }
}
