#include "poleline.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
using namespace poleline;
void require(bool b,const char* message){if(!b){std::cerr<<message<<'\n';std::exit(1);}}
int main(){
 require(circuits().size()==25,"25 bundled fictional circuits");
 for(int c=0;c<25;c++){
  const auto& t=circuits()[c];
  require(validate(t,t.points).empty(),"A full centreline must validate");
  for(int tyre=0;tyre<3;tyre++){
   auto a=simulate(c,t.points,tyre),b=simulate(c,t.points,tyre);
   require(a.valid&&a.timeMs>10000&&a.timeMs<180000,"Full playable lap on each circuit and tyre");
   require(a.timeMs==b.timeMs&&a.speed==b.speed,"Deterministic repeated simulation");
   require(a.sectors[0]+a.sectors[1]+a.sectors[2]==a.timeMs&&a.sectors[0]>0&&a.sectors[1]>0&&a.sectors[2]>0,"Sectors match lap");
   require(a.time.size()==a.points.size()+1,"Closed lap playback");
   for(size_t i=0;i<a.points.size();i++)require(std::isfinite(a.speed[i])&&a.speed[i]>0&&a.battery[i]>=0&&a.battery[i]<=1&&a.time[i+1]>a.time[i],"Finite monotonic telemetry");
  }
  auto shortLine=t.points;shortLine.resize(40);require(!validate(t,shortLine).empty(),"Shortcuts rejected");
  auto reverse=t.points;std::reverse(reverse.begin()+1,reverse.end());require(!validate(t,reverse).empty(),"Reverse laps rejected");
  auto outside=t.points;outside[30].x+=1000;require(!validate(t,outside).empty(),"Off-road segments rejected");
  Drawing drawing(c);auto p=t.points.front();drawing.touch(0,p.x,p.y);
  for(size_t i=1;i<t.points.size();i++)drawing.touch(1,t.points[i].x,t.points[i].y);
  drawing.touch(1,p.x,p.y);
  require(drawing.json().find("\"done\":true")!=std::string::npos,"Real input path completes a lap");
  drawing.touch(3,0,0);require(drawing.points().empty(),"Undo restores stroke before finish");
 }
 auto line=circuits()[0].points;line[2].x=std::numeric_limits<double>::quiet_NaN();require(!simulate(0,line,0).valid,"NaN rejected");
 require(!simulate(-1,circuits()[0].points,0).valid,"Invalid index rejected");
 auto s=simulate(4,circuits()[4].points,0),h=simulate(4,circuits()[4].points,2);require(s.timeMs!=h.timeMs,"Tyre choice changes the result");
 std::cout<<"25 circuits, 75 tyre combinations, determinism, limits, shortcuts, reverse, drawing and undo passed.\n";
}
