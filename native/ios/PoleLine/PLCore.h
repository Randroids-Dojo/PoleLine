#import <Foundation/Foundation.h>
NS_ASSUME_NONNULL_BEGIN
@interface PLCore : NSObject
+ (NSString *)catalog;
+ (NSString *)circuit:(NSInteger)index;
+ (NSString *)touch:(NSInteger)action x:(double)x y:(double)y;
+ (NSString *)race:(NSInteger)index coordinates:(NSArray<NSNumber *> *)coordinates tyre:(NSInteger)tyre;
@end
NS_ASSUME_NONNULL_END
