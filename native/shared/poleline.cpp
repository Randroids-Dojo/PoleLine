#include "poleline.h"
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>

namespace poleline {
namespace {
constexpr double G = 9.81, MASS = 865, POWER = 285000, ELECTRIC = 135000;
constexpr double CAPACITY = 2700000, MAX_SPEED = 94;
double square(double v) { return v*v; }
double distance(Point a, Point b) { return std::sqrt(square(a.x-b.x)+square(a.y-b.y)); }
double clamp(double v, double lo, double hi) { return std::max(lo, std::min(hi,v)); }
Point mix(Point a, Point b, double f) { return {a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f}; }
Point quantize(Point p) { return {std::round(p.x*10)/10,std::round(p.y*10)/10}; }
std::ostringstream stream() { std::ostringstream s; s.imbue(std::locale::classic()); s<<std::fixed<<std::setprecision(6); return s; }
std::string quoted(const std::string& v) {
    std::string out="\"";
    for(char c:v) { if(c=='"'||c=='\\') out+='\\'; if(c=='\n') out+="\\n"; else out+=c; }
    return out+'"';
}
void pointsJson(std::ostream& out,const std::vector<Point>& points) {
    out<<'[';
    for(size_t i=0;i<points.size();++i) { if(i)out<<','; out<<'['<<points[i].x<<','<<points[i].y<<']'; }
    out<<']';
}
void numbersJson(std::ostream& out,const std::vector<double>& values) {
    out<<'['; for(size_t i=0;i<values.size();++i) { if(i)out<<','; out<<values[i]; } out<<']';
}
bool finite(Point p) { return std::isfinite(p.x)&&std::isfinite(p.y)&&std::abs(p.x)<100000&&std::abs(p.y)<100000; }
const Circuit* get(int i) { return i>=0&&i<static_cast<int>(circuits().size())?&circuits()[i]:nullptr; }
struct Geometry {
    std::vector<Point> p;
    std::vector<double> ds,k,progress;
};
Geometry geometry(const Circuit& track,const std::vector<Point>& line) {
    Geometry geo;
    std::vector<double> start(line.size(),0);
    double total=0;
    for(size_t i=0;i<line.size();i++) {start[i]=total; total+=distance(line[i],line[(i+1)%line.size()]);}
    int n=std::max(128,static_cast<int>(std::round(total/2)));
    n=std::min(n,10000);
    size_t seg=0;
    std::vector<Point> raw;
    for(int i=0;i<n;i++) {
        double target=total*i/n;
        while(seg+1<line.size()&&start[seg+1]<target) seg++;
        auto a=line[seg],b=line[(seg+1)%line.size()];
        raw.push_back(mix(a,b,(target-start[seg])/std::max(.000001,distance(a,b))));
    }
    geo.p.resize(n);geo.ds.resize(n);geo.k.resize(n);geo.progress.resize(n);
    // A short circular filter removes fingertip jitter. Keep every filtered point on road.
    for(int i=0;i<n;i++) {
        Point p{};double weight=0;
        for(int d=-3;d<=3;d++) {double w=4-std::abs(d);auto q=raw[(i+d+n)%n];p.x+=q.x*w;p.y+=q.y*w;weight+=w;}
        p.x/=weight;p.y/=weight;
        auto rawProjection=project(track,raw[i],i*static_cast<int>(track.points.size())/n,static_cast<int>(track.points.size()));
        geo.p[i]=project(track,p,rawProjection.segment).distance<track.width*.5?p:raw[i];
    }
    int hint=0;double previous=0,progress=0;const double len=length(track);
    for(int i=0;i<n;i++) {
        auto a=geo.p[(i+n-2)%n],b=geo.p[i],c=geo.p[(i+2)%n];
        double den=distance(a,b)*distance(b,c)*distance(c,a);
        geo.k[i]=den>1e-8?std::abs(2*((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))/den):0;
        geo.ds[i]=std::max(.000001,distance(geo.p[i],geo.p[(i+1)%n]));
        auto pr=project(track,raw[i],hint);hint=pr.segment;
        double d=pr.progress-previous;
        if(d < -len*.5)d+=len;
        if(d > len*.5)d-=len;
        progress+=d;previous=pr.progress;geo.progress[i]=progress;
    }
    return geo;
}
struct Tyre {double grip,opt,window,warm,heat;};
const Tyre TYRES[]={{1,91,19,46,1.0},{.984,104,24,43,.78},{.960,117,29,39,.57}};
double lateral(double v,double grip,double cla) {
    double load=1+.5*1.18*cla*v*v/(MASS*G);
    return 1.72*grip*(1-.055*(load-1))*G*load;
}
double electric(double v,double cutoff) {
    return ELECTRIC*clamp((102-v)/22,0,1)*clamp((cutoff+4-v)/8,0,1);
}
std::vector<double> speeds(const Geometry& geo,const Circuit& track,const std::vector<double>& grip,double cutoff) {
    int n=static_cast<int>(geo.p.size());double cla=2.6+track.trim*.23,cda=.82+track.trim*.075;
    std::vector<double> limit(n),v(n);
    int slow=0;
    for(int i=0;i<n;i++) {
        double lo=2,hi=MAX_SPEED;
        for(int it=0;it<28;it++) {double m=(lo+hi)*.5;if(m*m*geo.k[i]<=lateral(m,grip[i],cla))lo=m;else hi=m;}
        limit[i]=lo;v[i]=lo;if(lo<limit[slow])slow=i;
    }
    // Circular passes settle both braking and acceleration across the finish line.
    for(int pass=0;pass<3;pass++) {
        for(int s=0;s<n;s++) {
            int i=(slow+s)%n,j=(i+1)%n;
            double vi=v[i],lat=lateral(vi,grip[i],cla),u=clamp(vi*vi*geo.k[i]/lat,0,1);
            double available=std::sqrt(1-u*u),drag=.5*1.18*cda*vi*vi;
            double force=std::min(MASS*lat*.61*available,(POWER+electric(vi,cutoff))/std::max(vi,10.0));
            double acceleration=(force-drag-MASS*G*.012)/MASS;
            v[j]=std::min(v[j],std::sqrt(std::max(4.0,vi*vi+2*acceleration*geo.ds[i])));
        }
        for(int s=0;s<n;s++) {
            int j=(slow-s+n)%n,i=(j+n-1)%n;
            double vj=v[j],lat=lateral(vj,grip[j],cla),u=clamp(vj*vj*geo.k[j]/lat,0,1);
            double decel=lat*.84*std::sqrt(1-u*u)+.5*1.18*cda*vj*vj/MASS;
            v[i]=std::min(v[i],std::sqrt(vj*vj+2*decel*geo.ds[i]));
        }
    }
    return v;
}
double energy(const Geometry& geo,const Circuit& track,const std::vector<double>& v,double cutoff,std::vector<double>* battery) {
    double charge=CAPACITY,minimum=charge;
    if(battery)battery->resize(v.size());
    for(size_t i=0;i<v.size();i++) {
        size_t j=(i+1)%v.size();double dt=2*geo.ds[i]/(v[i]+v[j]);
        if(battery)(*battery)[i]=clamp(charge/CAPACITY,0,1);
        double a=(v[j]*v[j]-v[i]*v[i])/(2*geo.ds[i]);
        double need=(MASS*a+.5*1.18*(.82+track.trim*.075)*v[i]*v[i]+MASS*G*.012)*v[i];
        if(need>0) {double e=electric(v[i],cutoff);charge-=std::min(e,need*e/(POWER+e))*dt;}
        else charge+=std::min(95000.0,-need*.74)*dt;
        charge=std::min(charge,CAPACITY);minimum=std::min(minimum,charge);
    }
    return minimum;
}
}

const std::vector<Circuit>& circuits() {
    static const std::vector<Circuit> tracks={
#include "generated/circuits.inc"
    };
    return tracks;
}
double length(const Circuit& track) {double l=0;for(size_t i=0;i<track.points.size();i++)l+=distance(track.points[i],track.points[(i+1)%track.points.size()]);return l;}
Projection project(const Circuit& track,Point p,int hint,int window) {
    const int n=static_cast<int>(track.points.size());
    std::vector<double> start(n);double acc=0;
    for(int i=0;i<n;i++){start[i]=acc;acc+=distance(track.points[i],track.points[(i+1)%n]);}
    Projection best;best.distance=std::numeric_limits<double>::infinity();
    for(int k=-window;k<=window;k++) {
        int i=((hint+k)%n+n)%n;auto a=track.points[i],b=track.points[(i+1)%n];
        double len=distance(a,b);double u=clamp(((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/(len*len),0,1);
        double dist=distance(p,mix(a,b,u));
        if(dist<best.distance){best={i,start[i]+u*len,dist};}
    }
    return best;
}
std::string validate(const Circuit& track,const std::vector<Point>& line) {
    if(line.size()<12||line.size()>12000)return "Draw one complete lap before racing";
    for(auto p:line)if(!finite(p))return "This line contains an invalid point";
    if(distance(line.front(),track.points[0])>track.width*.75)return "Start on the chequered line";
    double progress=0,previous=0,len=length(track);int hint=0;
    for(size_t i=0;i<line.size();i++) {
        Point a=line[i],b=line[(i+1)%line.size()];
        double span=distance(a,b);if(span>len*.3)return "Keep your line on the road";
        int steps=std::max(1,static_cast<int>(std::ceil(span/2)));
        for(int j=0;j<=steps;j++) {
            auto pr=project(track,mix(a,b,static_cast<double>(j)/steps),hint);hint=pr.segment;
            if(pr.distance>track.width*.5+.15)return "Track limits: undo the last stroke";
            double d=pr.progress-previous;
            if(d< -len*.5)d+=len;if(d>len*.5)d-=len;
            if(d< -2.5)return "Follow the arrows around the circuit";
            progress+=d;previous=pr.progress;
        }
    }
    if(progress<len*.985||progress>len*1.015)return "Complete the full circuit and cross the finish line";
    if(distance(line.back(),line.front())>track.width)return "Join your line at the chequered flag";
    return {};
}
Lap simulate(int circuit,const std::vector<Point>& line,int tyre) {
    Lap lap;lap.tyre=tyre;const auto* track=get(circuit);
    if(!track||tyre<0||tyre>2){lap.error="Invalid circuit or tyre";return lap;}
    lap.error=validate(*track,line);if(!lap.error.empty())return lap;
    auto geo=geometry(*track,line);const size_t n=geo.p.size();const Tyre& spec=TYRES[tyre];
    std::vector<double> grip(n,spec.grip*track->grip),v(n),temp(n);
    double cutoff=1000;
    for(int feedback=0;feedback<4;feedback++) {
        v=speeds(geo,*track,grip,1000);cutoff=1000;
        if(energy(geo,*track,v,1000,nullptr)<0) {
            double lo=0,hi=MAX_SPEED;
            for(int b=0;b<12;b++){double cut=(lo+hi)*.5;auto candidate=speeds(geo,*track,grip,cut);if(energy(geo,*track,candidate,cut,nullptr)>=0)lo=cut;else hi=cut;}
            cutoff=lo;v=speeds(geo,*track,grip,cutoff);
        }
        double temperature=track->trackTemp+spec.warm;
        for(size_t i=0;i<n;i++) {
            size_t j=(i+1)%n;double dt=2*geo.ds[i]/(v[i]+v[j]);temp[i]=temperature;
            double deviation=(temperature-spec.opt)/spec.window;
            double nextGrip=spec.grip*track->grip*(1-.07*deviation*deviation/(1+.13*deviation*deviation));
            double lat=v[i]*v[i]*geo.k[i],lon=(v[j]*v[j]-v[i]*v[i])/(2*geo.ds[i]);
            double load=std::sqrt(lat*lat+lon*lon);
            temperature+=dt*(spec.heat*1.8*load*v[i]/1000-(.014+.0003*v[i])*(temperature-(track->airTemp+track->trackTemp)*.5-28));
            if(feedback<3)grip[i]=nextGrip;
        }
    }
    lap.valid=true;lap.points=std::move(geo.p);lap.speed=v;lap.progress=geo.progress;lap.temperature=temp;
    energy(geo,*track,v,cutoff,&lap.battery);lap.time.resize(n+1,0);
    for(size_t i=0;i<n;i++){lap.time[i+1]=lap.time[i]+2*geo.ds[i]/(v[i]+v[(i+1)%n]);lap.distance+=geo.ds[i];lap.topSpeed=std::max(lap.topSpeed,v[i]);}
    lap.timeMs=static_cast<int>(std::round(lap.time[n]*1000));
    int sectorEnds[3]={0,0,lap.timeMs};double len=length(*track);
    for(int sector=0;sector<2;sector++) {
        double target=len*(sector+1)/3;
        for(size_t i=1;i<n;i++)if(lap.progress[i]>=target){double f=(target-lap.progress[i-1])/std::max(.000001,lap.progress[i]-lap.progress[i-1]);sectorEnds[sector]=static_cast<int>(std::round((lap.time[i-1]+(lap.time[i]-lap.time[i-1])*f)*1000));break;}
    }
    lap.sectors[0]=sectorEnds[0];lap.sectors[1]=sectorEnds[1]-sectorEnds[0];lap.sectors[2]=sectorEnds[2]-sectorEnds[1];
    return lap;
}
std::string catalogJson() {
    auto s=stream();s<<'[';
    for(size_t i=0;i<circuits().size();i++){if(i)s<<',';const auto& t=circuits()[i];s<<"{\"index\":"<<i<<",\"id\":"<<quoted(t.id)<<",\"name\":"<<quoted(t.name)<<",\"region\":"<<quoted(t.region)<<",\"character\":"<<quoted(t.character)<<",\"length\":"<<length(t)<<",\"night\":"<<(t.night?"true":"false")<<'}';}
    s<<']';return s.str();
}
std::string circuitJson(int circuit) {
    const auto* t=get(circuit);if(!t)return "{}";
    auto s=stream();s<<"{\"index\":"<<circuit<<",\"id\":"<<quoted(t->id)<<",\"name\":"<<quoted(t->name)<<",\"character\":"<<quoted(t->character)<<",\"region\":"<<quoted(t->region)<<",\"width\":"<<t->width<<",\"length\":"<<length(*t)<<",\"air\":"<<t->airTemp<<",\"temperature\":"<<t->trackTemp<<",\"night\":"<<(t->night?"true":"false")<<",\"points\":";
    pointsJson(s,t->points);
    int reference=std::numeric_limits<int>::max();
    for(int tyre=0;tyre<3;tyre++){auto baseline=simulate(circuit,t->points,tyre);if(baseline.valid)reference=std::min(reference,baseline.timeMs);}
    s<<",\"gold\":"<<std::round(reference*1.025)<<",\"silver\":"<<std::round(reference*1.09)<<",\"bronze\":"<<std::round(reference*1.22)<<'}';return s.str();
}
std::string lapJson(const Lap& lap) {
    if(!lap.valid)return "{\"valid\":false,\"error\":"+quoted(lap.error)+"}";
    auto s=stream();s<<"{\"valid\":true,\"version\":"<<SIM_VERSION<<",\"tyre\":"<<lap.tyre<<",\"timeMs\":"<<lap.timeMs<<",\"sectors\":["<<lap.sectors[0]<<','<<lap.sectors[1]<<','<<lap.sectors[2]<<"],\"topSpeed\":"<<lap.topSpeed*3.6<<",\"distance\":"<<lap.distance<<",\"points\":";
    pointsJson(s,lap.points);s<<",\"speed\":";numbersJson(s,lap.speed);s<<",\"time\":";numbersJson(s,lap.time);s<<",\"progress\":";numbersJson(s,lap.progress);s<<",\"battery\":";numbersJson(s,lap.battery);s<<",\"temperature\":";numbersJson(s,lap.temperature);s<<'}';return s.str();
}
std::string raceJson(int circuit,const std::vector<double>& xy,int tyre) {
    if(xy.size()%2||xy.size()>24000)return "{\"valid\":false,\"error\":\"Invalid line\"}";
    std::vector<Point> line;for(size_t i=0;i+1<xy.size();i+=2)line.push_back(quantize({xy[i],xy[i+1]}));
    return lapJson(simulate(circuit,line,tyre));
}
Drawing::Drawing(int selected):circuit(get(selected)?selected:0){}
bool Drawing::extend(Point p) {
    const auto& track=circuits()[circuit];const double len=length(track);p=quantize(p);
    if(!finite(p)||line.empty())return false;
    Point a=line.back();double span=distance(a,p);if(span<.5)return true;
    if(span>track.width*4){message="Lift your finger and continue from the purple tip";return false;}
    int nextHint=hint;double nextProgress=progress,nextPrevious=previous;
    const int steps=std::max(1,static_cast<int>(std::ceil(span/2)));
    for(int i=1;i<=steps;i++) {
        auto pr=project(track,mix(a,p,static_cast<double>(i)/steps),nextHint);nextHint=pr.segment;
        if(pr.distance>track.width*.5){message="Track limits. Lift, then undo this stroke";return false;}
        double d=pr.progress-nextPrevious;if(d< -len*.5)d+=len;if(d>len*.5)d-=len;
        if(d< -2.5){message="Follow the arrows around the circuit";return false;}
        nextProgress+=d;nextPrevious=pr.progress;
    }
    if(line.size()>=12000){message="Too many points. Undo or start a new line";return false;}
    line.push_back(p);hint=nextHint;progress=nextProgress;previous=nextPrevious;
    if(progress>=len*.99&&distance(p,line.front())<track.width*.6) {
        auto trial=line;trial.push_back(line.front());
        auto error=validate(track,trial);
        if(error.empty()){line=std::move(trial);done=true;active=false;message="Lap drawn. Choose Race your line";return true;}
    }
    message="Lift any time. Continue from the purple tip";return true;
}
std::string Drawing::touch(int action,double x,double y) {
    const auto& track=circuits()[circuit];Point p={x,y};
    if(action==4){*this=Drawing(circuit);return json();}
    if(action==3) {
        active=false;done=false;
        if(!strokes.empty()){auto s=strokes.back();strokes.pop_back();line.resize(s.count);hint=s.hint;progress=s.progress;previous=s.previous;}
        if(line.size()<=1){line.clear();hint=0;progress=previous=0;}
        message="Stroke undone. Continue from the tip";return json();
    }
    if(done)return json();
    if(action==2){active=false;return json();}
    if(action==0) {
        active=false;
        if(!finite(p)){message="Touch the track to draw";return json();}
        if(line.empty()) {
            if(distance(p,track.points[0])>track.width*.8){message="Start on the chequered line";return json();}
            strokes.push_back({0,0,0,0});line.push_back(track.points[0]);active=true;
        } else if(distance(p,line.back())<track.width*.8) {
            strokes.push_back({line.size(),hint,progress,previous});active=true;
        } else {message="Continue from the purple tip, or undo";return json();}
        extend(p);
    } else if(action==1&&active) {
        if(!extend(p))active=false;
    }
    return json();
}
std::string Drawing::json() const {
    auto s=stream();s<<"{\"done\":"<<(done?"true":"false")<<",\"active\":"<<(active?"true":"false")<<",\"progress\":"<<clamp(progress/length(circuits()[circuit]),0,1)<<",\"message\":"<<quoted(message)<<",\"points\":";pointsJson(s,line);s<<'}';return s.str();
}
}
