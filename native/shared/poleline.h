#pragma once
#include <string>
#include <vector>

namespace poleline {
constexpr int SIM_VERSION = 1;
struct Point { double x = 0, y = 0; };
struct Circuit {
    std::string id, name, region, character;
    double width, airTemp, trackTemp, grip;
    int trim;
    bool night;
    std::vector<Point> points;
};
struct Projection { int segment = 0; double progress = 0, distance = 0; };
struct Lap {
    bool valid = false;
    std::string error;
    int tyre = 0, timeMs = 0;
    int sectors[3] = {0, 0, 0};
    std::vector<Point> points;
    std::vector<double> speed, time, progress, battery, temperature;
    double topSpeed = 0, distance = 0;
};
const std::vector<Circuit>& circuits();
double length(const Circuit& track);
Projection project(const Circuit& track, Point p, int hint, int window = 20);
std::string validate(const Circuit& track, const std::vector<Point>& line);
Lap simulate(int circuit, const std::vector<Point>& line, int tyre);
std::string catalogJson();
std::string circuitJson(int circuit);
std::string lapJson(const Lap& lap);
std::string raceJson(int circuit, const std::vector<double>& xy, int tyre);

class Drawing {
public:
    explicit Drawing(int circuit = 0);
    std::string touch(int action, double x, double y);
    std::string json() const;
    const std::vector<Point>& points() const { return line; }
private:
    int circuit, hint = 0;
    double progress = 0, previous = 0;
    bool active = false, done = false;
    std::string message = "Start on the chequered line";
    std::vector<Point> line;
    struct Stroke { size_t count; int hint; double progress, previous; };
    std::vector<Stroke> strokes;
    bool extend(Point p);
};
}
