#import "PLCore.h"
#include "../../shared/poleline.h"
#include <memory>
namespace { std::unique_ptr<poleline::Drawing> drawing=std::make_unique<poleline::Drawing>(); }
@implementation PLCore
+ (NSString *)catalog {return [NSString stringWithUTF8String:poleline::catalogJson().c_str()];}
+ (NSString *)circuit:(NSInteger)index {drawing=std::make_unique<poleline::Drawing>((int)index);return [NSString stringWithUTF8String:poleline::circuitJson((int)index).c_str()];}
+ (NSString *)touch:(NSInteger)action x:(double)x y:(double)y {return [NSString stringWithUTF8String:drawing->touch((int)action,x,y).c_str()];}
+ (NSString *)race:(NSInteger)index coordinates:(NSArray<NSNumber *> *)coordinates tyre:(NSInteger)tyre {
    std::vector<double> xy;xy.reserve(coordinates.count);
    for(NSNumber *number in coordinates)xy.push_back(number.doubleValue);
    return [NSString stringWithUTF8String:poleline::raceJson((int)index,xy,(int)tyre).c_str()];
}
@end
